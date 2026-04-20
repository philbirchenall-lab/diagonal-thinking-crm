const EMDASH = String.fromCodePoint(0x2014);
const HTML_COMMENT_PATTERN = /^<!--.*-->$/;

const noEmdashMarkdownRule = {
  names: ["dt-no-emdash"],
  description:
    "Disallow U+2014 em-dash in Markdown. Use an ASCII hyphen or the approved bypass comment.",
  tags: ["style", "dt-brand"],
  parser: "none",
  function(params, onError) {
    const lines = params.lines || [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      if (typeof line !== "string" || !line.includes(EMDASH)) {
        continue;
      }

      const previousLine = index > 0 ? lines[index - 1] : "";
      if (
        typeof previousLine === "string" &&
        HTML_COMMENT_PATTERN.test(previousLine.trim())
      ) {
        continue;
      }

      onError({
        lineNumber: index + 1,
        detail:
          "Em-dash (U+2014) not permitted. Replace with an ASCII hyphen (-) or add `<!-- brand:allow-emdash -->` on the preceding line.",
        context: line.slice(0, 120),
      });
    }
  },
};

export default noEmdashMarkdownRule;
