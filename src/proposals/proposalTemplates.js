function paragraph(text) {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

function heading(text) {
  return {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text }],
  };
}

function bulletList(items) {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [paragraph(item)],
    })),
  };
}

export function createGenericProposalDoc(clientName = "your team", programmeName = "the programme") {
  return {
    type: "doc",
    content: [
      heading("Overview"),
      paragraph(`This proposal outlines how Diagonal Thinking can support ${clientName} through ${programmeName}.`),
      paragraph("The approach below is designed to be practical, tailored, and focused on meaningful outcomes."),
      heading("Objectives"),
      bulletList([
        "Clarify the outcomes this work needs to achieve",
        "Build confidence and capability in the team",
        "Create practical next steps that can be implemented quickly",
      ]),
      heading("What We Will Deliver"),
      bulletList([
        "Discovery and preparation ahead of the session",
        "A tailored facilitated workshop or engagement",
        "A concise set of recommendations and next actions",
      ]),
      heading("Approach"),
      paragraph("We will shape the work around your context, current priorities, and the people involved."),
      paragraph("Sessions are designed to be engaging, clear, and immediately useful."),
      heading("Next Steps"),
      bulletList([
        "Confirm scope and timing",
        "Agree attendees and any pre-work",
        "Schedule delivery and follow-up",
      ]),
    ],
  };
}

export function createWorkshopProposalDoc(clientName = "your team") {
  return {
    type: "doc",
    content: [
      heading("Session Focus"),
      paragraph(`This workshop is designed for ${clientName} and will combine strategic discussion with practical working sessions.`),
      heading("What Participants Will Leave With"),
      bulletList([
        "A clearer understanding of the opportunity and challenge",
        "Shared language and confidence across the group",
        "A practical action plan for immediate next steps",
      ]),
      heading("Suggested Structure"),
      bulletList([
        "Context setting and goals",
        "Interactive working session",
        "Priority mapping and decision-making",
        "Action planning and close",
      ]),
      heading("Outputs"),
      bulletList([
        "Facilitated session design",
        "Supporting materials where needed",
        "A follow-up summary with recommendations",
      ]),
    ],
  };
}

export function isDocEmpty(doc) {
  return !doc?.content || doc.content.length === 0;
}
