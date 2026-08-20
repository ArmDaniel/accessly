import { node, type AccessibleNode, type AccessibleTree, type TreeUnknown } from '@accessly/core';
import { attr, findAll, findFirst, parseXml, type XmlNode } from '../xml.js';
import { openArchive } from '../zip.js';

/**
 * Spreadsheet adapter.
 *
 * A spreadsheet is a grid, and a grid without headers is unreadable with a
 * screen reader - the user hears "42" with no idea which column it is in.
 * Excel records headers in exactly one structural way: a *table* (`xl/tables/`)
 * with `headerRowCount`. A bold first row is formatting, not structure, and
 * that distinction is the whole reason this adapter exists.
 *
 * Sheets, names and tables are wired together through the package's
 * relationship files, and the wiring matters: a workbook's declared sheet
 * order is not its part numbering (Excel does not rename parts when sheets
 * are reordered), and a table belongs to the one sheet whose `.rels` names it.
 * Guessing either association produces headers on sheets that have none.
 *
 * We deliberately do not read cell values. The accessibility questions here are
 * structural - are there headers, does each sheet have a meaningful name - and
 * pulling in the shared-strings table to read content would add cost for no
 * diagnostic gain.
 */

function sheetIndex(path: string): number {
  const match = /sheet(\d+)\.xml$/.exec(path);
  return match ? Number.parseInt(match[1] as string, 10) : 0;
}

const DEFAULT_SHEET_NAME = /^(sheet|blad|feuille|hoja|foglio|tabelle)\s*\d+$/i;

/** Resolve a relationship target against the directory of the part that cites it. */
function resolvePart(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const segments = (baseDir ? baseDir.split('/') : []).filter(Boolean);
  for (const segment of target.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '.' && segment.length > 0) segments.push(segment);
  }
  return segments.join('/');
}

/**
 * Parse a `.rels` part into id → target pairs. Relationship files are the only
 * place OPC records which table belongs to which sheet.
 */
function readRelationships(xml: string | null): Map<string, string> {
  const map = new Map<string, string>();
  const parsed = xml ? parseXml(xml) : null;
  if (!parsed) return map;
  for (const relationship of findAll(parsed, 'Relationship')) {
    const id = attr(relationship, 'id');
    const target = attr(relationship, 'target');
    if (id && target) map.set(id, target);
  }
  return map;
}

interface SheetInfo {
  readonly name: string;
  readonly path: string;
}

export function parseXlsx(bytes: Uint8Array): AccessibleTree {
  // The XML skeleton only. A real workbook embeds images under xl/media/ and
  // cached chart data under xl/charts/ - bytes the adapter never reads.
  const archive = openArchive(bytes, {
    include: (name) =>
      name === '[Content_Types].xml' ||
      name.startsWith('docProps/') ||
      (name.startsWith('xl/') &&
        !/^(xl\/(media|theme|drawings|charts|embeddings|printerSettings)\/)/.test(name)),
  });
  const unknowns: TreeUnknown[] = [];

  const workbookXml = archive.text('xl/workbook.xml');
  const workbook = workbookXml ? parseXml(workbookXml) : null;

  if (!workbook) {
    return {
      mediaKind: 'xlsx',
      title: null,
      lang: null,
      root: node({ role: 'document', name: null, locator: { path: 'Workbook' }, props: {} }),
      unknowns: [
        { topic: 'structure-tree', reason: 'xl/workbook.xml is missing or could not be parsed.' },
      ],
      producer: 'accessly-xlsx-adapter/1',
    };
  }

  if (archive.truncated) {
    unknowns.push({
      topic: 'archive-truncated',
      reason: 'The archive expands beyond Accessly\u2019s size limits, so some parts were not read.',
    });
  }

  /*
   * Map each declared sheet to its real part through the workbook's
   * relationships. Without this, a workbook whose sheets were reordered gets
   * the wrong names on the wrong parts, and the report names a sheet the
   * customer cannot find.
   */
  const workbookRels = readRelationships(archive.text('xl/_rels/workbook.xml.rels'));
  const declaredSheets = findAll(workbook, 'sheet');
  const sheets: SheetInfo[] = [];
  if (workbookRels.size > 0) {
    for (const sheet of declaredSheets) {
      const name = attr(sheet, 'name') ?? '';
      const relId = attr(sheet, 'id') ?? '';
      const target = workbookRels.get(relId);
      if (!target) continue;
      const path = resolvePart('xl', target);
      if (archive.has(path)) sheets.push({ name, path });
    }
  }

  /*
   * No relationships at all (a hand-built or minimal workbook): pair the
   * declared names with part order. Imperfect - it assumes part numbering
   * follows declaration order - but it keeps every worksheet auditable and
   * keeps the customer's sheet names in the report.
   */
  if (sheets.length === 0) {
    const parts = archive
      .match((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
      .slice()
      .sort((a, b) => sheetIndex(a) - sheetIndex(b));
    const names = declaredSheets.map((sheet) => attr(sheet, 'name') ?? '');
    for (const [index, path] of parts.entries()) {
      sheets.push({ name: names[index] ?? `Sheet ${index + 1}`, path });
    }
  }

  const tableNamesBySheet = new Map<string, string>();
  for (const { path } of sheets) {
    const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    const rels = readRelationships(archive.text(relsPath));
    for (const [relId, target] of rels) {
      void relId;
      if (!/\/?tables\/table\d+\.xml$/.test(target)) continue;
      const tablePath = resolvePart(path.slice(0, path.lastIndexOf('/')), target);
      const xml = archive.text(tablePath);
      const parsed = xml ? parseXml(xml) : null;
      const table = parsed ? findFirst(parsed, 'table') : null;
      // `headerRowCount="0"` is an explicit "this table has no header row".
      const headerRows = table
        ? Number.parseInt(attr(table, 'headerRowCount') ?? '1', 10)
        : 1;
      if (table && headerRows > 0) {
        tableNamesBySheet.set(path, attr(table, 'displayName') ?? attr(table, 'name') ?? 'Table');
      }
    }
  }

  const children: AccessibleNode[] = sheets.map(({ name, path }, index) => {
    const xml = archive.text(path);
    const parsed = xml ? parseXml(xml) : null;

    // An auto-filter is a weaker signal than a table but still indicates the
    // author told Excel where the header row is.
    const hasAutoFilter = parsed !== null && findFirst(parsed, 'autoFilter') !== null;
    const tableName = tableNamesBySheet.get(path) ?? null;
    const hasTable = tableName !== null;
    const rows = parsed ? findAll(parsed, 'row').length : 0;

    const cells: AccessibleNode[] =
      hasTable || hasAutoFilter
        ? [
            node({
              role: 'columnheader',
              name: null,
              text: tableName ?? 'Header row',
              locator: { path: `${name} > Header row`, page: index + 1 },
              props: { source: 'xlsx' },
            }),
          ]
        : [];

    return node({
      role: 'table',
      name,
      locator: { path: `Sheet "${name}"`, page: index + 1 },
      props: {
        source: 'xlsx',
        rows,
        // No table part and no auto-filter means no structural header. Excel
        // does not record "the first row is bold", so we cannot tell a styled
        // header from none at all - hence cantTell rather than a failure.
        headerRowUnknown: !hasTable && !hasAutoFilter,
      },
      children: [
        ...cells,
        // A row placeholder so the table rule sees more than one cell and
        // treats the sheet as data rather than skipping it.
        ...(rows > 1
          ? [
              node({
                role: 'row',
                name: null,
                locator: { path: `${name} > Data`, page: index + 1 },
                props: {},
                /*
                 * Two representative cells, not the real grid. The structural
                 * questions - are there headers, is this tabular at all - need
                 * to know a table has data, not what the data says.
                 */
                children: [
                  node({
                    role: 'cell',
                    name: null,
                    text: `${rows} rows`,
                    locator: { path: `${name} > Data`, page: index + 1 },
                    props: {},
                  }),
                  node({
                    role: 'cell',
                    name: null,
                    text: 'data',
                    locator: { path: `${name} > Data`, page: index + 1 },
                    props: {},
                  }),
                ],
              }),
            ]
          : []),
      ],
    });
  });

  const declaredNames = sheets.map((sheet) => sheet.name);
  const genericNames = declaredNames.filter((name) => DEFAULT_SHEET_NAME.test(name));
  if (genericNames.length > 0) {
    unknowns.push({
      topic: 'sheet-names',
      reason: `${genericNames.length} sheet(s) still carry a default name (${genericNames.join(', ')}), which tells a screen reader user nothing about the contents.`,
    });
  }

  const core = archive.text('docProps/core.xml');
  const parsedCore: XmlNode | null = core ? parseXml(core) : null;
  const title = parsedCore ? (findFirst(parsedCore, 'title')?.text ?? null) : null;
  const lang = parsedCore ? (findFirst(parsedCore, 'language')?.text ?? null) : null;

  return {
    mediaKind: 'xlsx',
    title: title && title.trim().length > 0 ? title.trim() : null,
    lang: lang && lang.trim().length > 0 ? lang.trim() : null,
    root: node({
      role: 'document',
      name: title,
      locator: { path: 'Workbook' },
      props: { source: 'xlsx', sheetCount: children.length },
      children,
    }),
    unknowns,
    producer: 'accessly-xlsx-adapter/1',
  };
}
