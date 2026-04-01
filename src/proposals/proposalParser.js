function makeText(text) {
  return { type: "text", text };
}

function makeBoldText(text) {
  return { type: "text", marks: [{ type: "bold" }], text };
}

function makeItalicText(text) {
  return { type: "text", marks: [{ type: "italic" }], text };
}

function makeHeading(text) {
  return {
    type: "heading",
    attrs: { level: 2 },
    content: [makeText(text)],
  };
}

function makeParagraph(content) {
  return { type: "paragraph", content };
}

function makeEmptyParagraph() {
  return { type: "paragraph", content: [] };
}

function makeBulletList(items) {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [makeParagraph([makeText(item)])],
    })),
  };
}

function makeLabelParagraph(label, value) {
  return {
    type: "paragraph",
    attrs: { class: "label-paragraph" },
    content: [makeBoldText(`${label}: `), makeText(value)],
  };
}

const COVER_PREPARED_FOR = /^prepared\s+for\s*:\s*(.+)/i;
const COVER_PREPARED_BY = /^prepared\s+by\s*:\s*(.+)/i;
const COVER_DATE = /^date\s*:\s*(.+)/i;
const COVER_PROGRAM = /^program\s*(?:title)?\s*:\s*(.+)/i;
const COVER_SUBTITLE = /^subtitle\s*:\s*(.+)/i;

const LABEL_RE = /^([A-Za-z][^:]{1,25}):\s+(\S.*)$/;
const NUMBERED_RE = /^\d+\.\s+/;
const BULLET_RE = /^[•\-*]\s*/;
const QUOTE_RE = /^"/;

function isAllCaps(line) {
  return line.length > 2 && line === line.toUpperCase() && /[A-Z]/.test(line);
}

export function parseProposalText(text) {
  const lines = text.split("\n");
  const coverFields = {
    program_title: "",
    subtitle: "",
    prepared_for: "",
    prepared_by: "",
    date: "",
  };
  const bodyLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (COVER_PREPARED_FOR.test(trimmed)) {
      coverFields.prepared_for = trimmed.replace(COVER_PREPARED_FOR, "$1").trim();
    } else if (COVER_PREPARED_BY.test(trimmed)) {
      coverFields.prepared_by = trimmed.replace(COVER_PREPARED_BY, "$1").trim();
    } else if (COVER_DATE.test(trimmed)) {
      coverFields.date = trimmed.replace(COVER_DATE, "$1").trim();
    } else if (COVER_PROGRAM.test(trimmed)) {
      coverFields.program_title = trimmed.replace(COVER_PROGRAM, "$1").trim();
    } else if (COVER_SUBTITLE.test(trimmed)) {
      coverFields.subtitle = trimmed.replace(COVER_SUBTITLE, "$1").trim();
    } else {
      bodyLines.push(line);
    }
  }

  const nodes = [];
  let pendingBullets = [];
  let prevWasBlank = true;

  function flushBullets() {
    if (pendingBullets.length > 0) {
      nodes.push(makeBulletList(pendingBullets));
      pendingBullets = [];
    }
  }

  for (const raw of bodyLines) {
    const trimmed = raw.trim();

    if (trimmed === "") {
      flushBullets();
      nodes.push(makeEmptyParagraph());
      prevWasBlank = true;
      continue;
    }

    if (BULLET_RE.test(trimmed)) {
      pendingBullets.push(trimmed.replace(BULLET_RE, ""));
      prevWasBlank = false;
      continue;
    }

    flushBullets();

    if (QUOTE_RE.test(trimmed)) {
      nodes.push(makeParagraph([makeItalicText(trimmed)]));
      prevWasBlank = false;
      continue;
    }

    if (NUMBERED_RE.test(trimmed)) {
      nodes.push(makeParagraph([makeBoldText(trimmed)]));
      prevWasBlank = false;
      continue;
    }

    const labelMatch = LABEL_RE.exec(trimmed);
    if (labelMatch) {
      nodes.push(makeLabelParagraph(labelMatch[1], labelMatch[2]));
      prevWasBlank = false;
      continue;
    }

    if (isAllCaps(trimmed) && trimmed.length < 60) {
      nodes.push(makeHeading(trimmed));
      prevWasBlank = false;
      continue;
    }

    if (prevWasBlank && trimmed.length < 50 && !/[,;]/.test(trimmed) && !trimmed.endsWith(".")) {
      nodes.push(makeHeading(trimmed));
      prevWasBlank = false;
      continue;
    }

    nodes.push(makeParagraph([makeText(trimmed)]));
    prevWasBlank = false;
  }

  flushBullets();

  return {
    coverFields,
    doc: {
      type: "doc",
      content: nodes,
    },
  };
}
