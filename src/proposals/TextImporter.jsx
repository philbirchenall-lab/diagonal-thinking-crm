import { useState } from "react";
import { parseProposalText } from "./proposalParser.js";

export default function TextImporter({ onImport }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(false);

  function handleParse() {
    if (!text.trim()) return;
    onImport(parseProposalText(text));
    setParsed(true);
  }

  function handleClear() {
    setText("");
    setParsed(false);
  }

  return (
    <div className="mb-4 overflow-hidden rounded-md border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
      >
        <span>Import from text</span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="bg-white p-4">
          <p className="mb-3 text-xs text-gray-500">
            Paste a draft proposal and the writer will pull out cover details like
            program title, prepared for, prepared by, and date.
          </p>
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setParsed(false);
            }}
            rows={12}
            placeholder={`Program title: AI for Leadership Teams\nPrepared for: ACME Corp\nPrepared by: Phil Birchenall, DIAGONAL // THINKING\nDate: April 2026\n\nINTRODUCTION\n\nThis proposal outlines...\n\n• Bullet point one\n• Bullet point two`}
            className="w-full resize-y rounded border border-gray-200 p-3 font-mono text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleParse}
              disabled={!text.trim()}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Parse and import
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="rounded border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
          {parsed && <p className="mt-2 text-sm text-green-600">Imported. Review and save when ready.</p>}
        </div>
      )}
    </div>
  );
}
