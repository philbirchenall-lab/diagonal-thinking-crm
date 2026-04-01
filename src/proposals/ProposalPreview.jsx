function hasMark(node, markType) {
  return node.marks?.some((mark) => mark.type === markType) ?? false;
}

function renderInlineContent(node, key) {
  if (node.type !== "text") return null;
  const isBold = hasMark(node, "bold");
  const isItalic = hasMark(node, "italic");
  let content = node.text ?? "";
  if (isBold && isItalic) content = <strong><em>{content}</em></strong>;
  else if (isBold) content = <strong>{content}</strong>;
  else if (isItalic) content = <em>{content}</em>;
  return <span key={key}>{content}</span>;
}

function renderNode(node, index) {
  switch (node.type) {
    case "heading":
      return (
        <h2 key={index} className="proposal-heading">
          {(node.content ?? []).map((child, childIndex) => renderInlineContent(child, childIndex))}
        </h2>
      );
    case "paragraph": {
      const content = node.content ?? [];
      if (content.length === 0) return <p key={index} className="proposal-para">&nbsp;</p>;
      const isLabelParagraph =
        node.attrs?.class === "label-paragraph" ||
        (content.length === 2 && hasMark(content[0], "bold") && !hasMark(content[1], "bold"));
      const className = isLabelParagraph ? "proposal-label" : "proposal-para";
      return (
        <p key={index} className={className}>
          {content.map((child, childIndex) => renderInlineContent(child, childIndex))}
        </p>
      );
    }
    case "bulletList":
      return (
        <ul key={index} className="proposal-bullet-list">
          {(node.content ?? []).map((item, itemIndex) => (
            <li key={itemIndex}>
              {(item.content ?? []).flatMap((paragraphNode) => paragraphNode.content ?? []).map((child, childIndex) =>
                renderInlineContent(child, `${itemIndex}-${childIndex}`),
              )}
            </li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={index} className="proposal-ordered-list">
          {(node.content ?? []).map((item, itemIndex) => (
            <li key={itemIndex}>
              {(item.content ?? []).flatMap((paragraphNode) => paragraphNode.content ?? []).map((child, childIndex) =>
                renderInlineContent(child, `${itemIndex}-${childIndex}`),
              )}
            </li>
          ))}
        </ol>
      );
    case "horizontalRule":
      return <hr key={index} className="proposal-rule" />;
    default:
      return null;
  }
}

export default function ProposalPreview({ proposal }) {
  return (
    <div className="proposal-preview-shell">
      <div className="proposal-preview-cover">
        <div className="proposal-preview-badge">Proposal</div>
        <h1 className="proposal-preview-title">{proposal.programTitle || "Untitled proposal"}</h1>
        {proposal.subtitle && <p className="proposal-preview-subtitle">{proposal.subtitle}</p>}
        <div className="proposal-preview-meta">
          <div><strong>Client:</strong> {proposal.clientName || "Not set yet"}</div>
          <div><strong>Prepared for:</strong> {proposal.preparedFor || "Not set yet"}</div>
          <div><strong>Date:</strong> {proposal.date || "Not set yet"}</div>
        </div>
      </div>
      <div className="proposal-document">
        <div className="proposal-body">
          {(proposal.doc?.content ?? []).map((node, index) => renderNode(node, index))}
        </div>
        <div className="proposal-footer">
          <span>{proposal.footerLabel || "The AI Advantage"}</span>
          <span>{proposal.preparedBy || "Diagonal Thinking"}</span>
        </div>
      </div>
    </div>
  );
}
