import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import EditorToolbar from "./EditorToolbar.jsx";

export default function ProposalEditor({ initialContent, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Start writing your proposal..." }),
    ],
    content: initialContent || { type: "doc", content: [] },
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getJSON());
    },
    editorProps: {
      attributes: {
        class: "proposal-document proposal-body",
      },
    },
  });

  return (
    <div className="overflow-hidden rounded-md border border-gray-200">
      <EditorToolbar editor={editor} />
      <div className="proposal-editor-wrapper">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
