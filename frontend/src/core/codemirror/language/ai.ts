/* Copyright 2024 Marimo. All rights reserved. */
import type { Extension } from "@codemirror/state";
import type { LanguageAdapter } from "./types";
import dedent from "string-dedent";
import type { CellId } from "@/core/cells/ids";
import type {
  CompletionConfig,
  LSPConfig,
  DiagnosticsConfig,
} from "@/core/config/config-schema";
import type { HotkeyProvider } from "@/core/hotkeys/hotkeys";
import { indentOneTab } from "./utils/indentOneTab";
import { type QuotePrefixKind, splitQuotePrefix } from "./utils/quotes";
import type { PlaceholderType } from "../config/types";

const quoteKinds = [
  ['"""', '"""'],
  ["'''", "'''"],
  ['"', '"'],
  ["'", "'"],
];

// explode into all combinations
//
// A note on f-strings:
//
// f-strings are not yet supported due to bad interactions with
// string escaping, LaTeX, and loss of Python syntax highlighting
const pairs = ["", "r"].flatMap((prefix) =>
  quoteKinds.map(([start, end]) => [prefix + start, end]),
);

const regexes = pairs.map(
  ([start, end]) =>
    // await mo.ai.agents.run_agent( + any number of spaces + start + capture + any number of spaces + end)
    [
      start,
      new RegExp(
        `^await\\smo\\.ai\\.agents\\.run_agent\\(\\s*${start}(.*)${end}\\s*\\)$`,
        "s",
      ),
    ] as const,
);

export interface AIAgentLanguageAdapterMetadata {
  quotePrefix: QuotePrefixKind;
}

/**
 * Language adapter for AI Agent.
 */
export class AIAgentLanguageAdapter
  implements LanguageAdapter<AIAgentLanguageAdapterMetadata>
{
  readonly type = "agent";
  readonly defaultCode = 'await mo.ai.agents.run_agent(r""" """)';
  readonly defaultMetadata: AIAgentLanguageAdapterMetadata = {
    quotePrefix: "r",
  };

  transformIn(
    pythonCode: string,
  ): [string, number, AIAgentLanguageAdapterMetadata] {
    pythonCode = pythonCode.trim();

    const metadata = { ...this.defaultMetadata };

    // empty string
    if (pythonCode === "") {
      return ["", 0, metadata];
    }

    for (const [start, regex] of regexes) {
      const match = pythonCode.match(regex);
      if (match) {
        const innerCode = match[1];

        const [quotePrefix, quoteType] = splitQuotePrefix(start);
        metadata.quotePrefix = quotePrefix;
        const unescapedCode = innerCode.replaceAll(`\\${quoteType}`, quoteType);

        const offset = pythonCode.indexOf(innerCode);
        // string-dedent expects the first and last line to be empty / contain only whitespace, so we pad with \n
        return [dedent(`\n${unescapedCode}\n`).trim(), offset, metadata];
      }
    }

    // no match
    return [pythonCode, 0, metadata];
  }

  transformOut(
    code: string,
    metadata: AIAgentLanguageAdapterMetadata,
  ): [string, number] {
    // Empty string
    if (code === "") {
      // Need at least a space, otherwise the output will be 6 quotes
      code = " ";
    }

    const { quotePrefix } = metadata;

    // We always transform back with triple quotes, as to avoid needing to
    // escape single quotes.
    const escapedCode = code.replaceAll('"""', String.raw`\"""`);

    // If its one line and not bounded by quotes, write it as single line
    const isOneLine = !code.includes("\n");
    const boundedByQuote = code.startsWith('"') || code.endsWith('"');
    if (isOneLine && !boundedByQuote) {
      const start = `await mo.ai.agents.run_agent(${quotePrefix}"""`;
      const end = `""")`;
      return [start + escapedCode + end, start.length];
    }

    // Multiline code
    const start = `await mo.ai.agents.run_agent(\n    ${quotePrefix}"""\n`;
    const end = `\n    """\n)`;
    return [start + indentOneTab(escapedCode) + end, start.length + 1];
  }

  isSupported(pythonCode: string): boolean {
    if (pythonCode.startsWith("await mo.ai.agents.run_agent(")) {
      return true;
    }

    if (pythonCode.trim() === "") {
      return true;
    }

    return regexes.some(([, regex]) => regex.test(pythonCode));
  }

  getExtension(
    _cellId: CellId,
    _completionConfig: CompletionConfig,
    _hotkeys: HotkeyProvider,
    _: PlaceholderType,
    _lspConfig: LSPConfig & { diagnostics?: DiagnosticsConfig },
  ): Extension[] {
    return [];
  }
}
