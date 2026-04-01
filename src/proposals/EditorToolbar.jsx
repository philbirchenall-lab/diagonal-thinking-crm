function ToolbarButton({ onClick, isActive, children, title }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      title={title}
      className={`px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
        isActive
          ? "bg-blue-100 text-blue-700 border border-blue-300"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px bg-gray-200" />;
}

export default function EditorToolbar({ editor }) {
  if (!editor) return null;

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 p-2">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="Bold"
      >
        <strong>B</strong>
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="Italic"
      >
        <em>I</em>
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        H2
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title="Bullet list"
      >
        • List
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title="Numbered list"
      >
        1. List
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={() => editor.chain().focus().setParagraph().run()}
        isActive={editor.isActive("paragraph")}
        title="Paragraph"
      >
        ¶
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        ―
      </ToolbarButton>

      <Divider />

      <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Undo">
        ↩
      </ToolbarButton>

      <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Redo">
        ↪
      </ToolbarButton>
    </div>
  );
}
