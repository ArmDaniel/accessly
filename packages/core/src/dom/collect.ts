/**
 * Raw text collectors shared by document-level rules.
 *
 * Several rules reason about `<style>` and `<script>` contents. Collecting that
 * text is trivial but was copy-pasted with small variations; one home keeps the
 * normalisation (whitespace collapse for CSS, joining for scripts) consistent.
 */

export function styleText(document: Document): string {
  return Array.from(document.querySelectorAll('style'))
    .map((element) => element.textContent ?? '')
    .join('\n');
}

/** `<style>` text with runs of whitespace collapsed — easier to regex safely. */
export function normalisedStyleText(document: Document): string {
  return styleText(document).replace(/\s+/g, ' ');
}

export function scriptText(document: Document): string {
  return Array.from(document.querySelectorAll('script'))
    .map((element) => element.textContent ?? '')
    .join('\n');
}
