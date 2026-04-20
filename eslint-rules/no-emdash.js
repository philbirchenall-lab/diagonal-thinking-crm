const EMDASH = String.fromCodePoint(0x2014);
const BYPASS_TOKEN = "brand:allow-emdash";

function hasBypassComment(sourceCode, node) {
  const line = node.loc?.start?.line;

  if (!line || line < 2) {
    return false;
  }

  return sourceCode.getAllComments().some((comment) => {
    return (
      comment.loc?.end?.line === line - 1 &&
      typeof comment.value === "string" &&
      comment.value.includes(BYPASS_TOKEN)
    );
  });
}

function reportIfNeeded(context, sourceCode, node, raw) {
  if (typeof raw !== "string" || !raw.includes(EMDASH)) {
    return;
  }

  if (hasBypassComment(sourceCode, node)) {
    return;
  }

  context.report({ node, messageId: "emdash" });
}

const noEmdashRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow U+2014 (em-dash). Use an ASCII hyphen or the approved bypass comment.",
      recommended: true,
    },
    schema: [],
    messages: {
      emdash:
        "Em-dash (U+2014) not permitted. Use an ASCII hyphen (-) or add `// brand:allow-emdash` on the preceding line.",
    },
  },
  create(context) {
    const sourceCode = context.getSourceCode();

    return {
      Literal(node) {
        if (typeof node.value === "string") {
          reportIfNeeded(context, sourceCode, node, node.value);
        }
      },
      TemplateElement(node) {
        if (typeof node.value?.raw === "string") {
          reportIfNeeded(context, sourceCode, node, node.value.raw);
        }
      },
      JSXText(node) {
        reportIfNeeded(context, sourceCode, node, node.value);
      },
      JSXAttribute(node) {
        if (
          node.value?.type === "Literal" &&
          typeof node.value.value === "string"
        ) {
          reportIfNeeded(context, sourceCode, node.value, node.value.value);
        }
      },
    };
  },
};

export default noEmdashRule;
