import MarkdownIt, { Token } from "markdown-it";
import { MarkdownParser } from "prosemirror-markdown";
import { MarkdownSerializerNodes } from "../../markdown-serializer";
import { assertAttrValue, getSnippetMetadata } from "./common";
import { Node as ProsemirrorNode, NodeSpec } from "prosemirror-model";

export const stackSnippetMarkdownParser: MarkdownParser["tokens"] = {
    stack_snippet: {
        block: "stack_snippet",
        getAttrs: (tok: Token) => ({
            hide: tok.attrGet("hide"),
            console: tok.attrGet("console"),
            babel: tok.attrGet("babel"),
            babelPresetReact: tok.attrGet("babelPresetReact"),
            babelPresetTS: tok.attrGet("babelPresetTS"),
        }),
    },

    stack_snippet_lang: {
        block: "stack_snippet_lang",
        noCloseToken: true,
        getAttrs: (tok: Token) => ({
            language: tok.attrGet("language"),
        }),
    },
};

export const stackSnippetMarkdownSerializer: MarkdownSerializerNodes = {
    stack_snippet(state, node) {
        const meta = getSnippetMetadata(node);
        state.write(
            `<!-- begin snippet: js hide: ${meta.hide} console: ${meta.console} babel: ${meta.babel} babelPresetReact: ${meta.babelPresetReact} babelPresetTS: ${meta.babelPresetTS} -->`
        );
        state.write("\n\n");
        node.forEach((langNode) => {
            const language = assertAttrValue(langNode, "language");
            state.write(`<!-- language: lang-${language} -->\n\n`);
            //Snippets expects a very specific format; no extra padding on empty lines
            // but the code itself needs padded with 4 spaces.
            const spacedContent = langNode.textContent
                .split("\n")
                .map((l) => (l !== "" ? "    " + l : l));
            for (let i = 0; i < spacedContent.length; i++) {
                state.write(spacedContent[i] + "\n");
            }
            state.write("\n");
        });
        state.write("<!-- end snippet -->");
        state.closeBlock(node);
    },
};

const validSnippetRegex =
    /^<!-- (?:begin snippet:|end snippet |language:)(.*)-->$/;
const langSnippetRegex = /^<!-- language: lang-(?<lang>css|html|js) -->/;
//Match the start snippet. Original editor is not order resilient.
const startSnippetRegex =
    /^<!-- begin snippet: js (?:hide: (?<hide>(?:true|false|null))\s)(?:console: (?<console>(?:true|false|null))\s)(?:babel: (?<babel>(?:true|false|null))\s)(?:babelPresetReact: (?<babelPresetReact>(?:true|false|null))\s)(?:babelPresetTS: (?<babelPresetTS>(?:true|false|null))\s)-->/;

interface RawContext {
    line: string;
    index: number;
}

interface BaseMetaLine {
    type: "begin" | "end" | "lang";
    index: number;
}

interface BeginMetaLine extends BaseMetaLine {
    type: "begin";
    //Strictly speaking these are `boolean | null`, but they don't affect operation
    babel: string;
    babelPresetReact: string;
    babelPresetTS: string;
    console: string;
    hide: string;
}

interface EndMetaLine extends BaseMetaLine {
    type: "end";
}

interface LangMetaLine extends BaseMetaLine {
    type: "lang";
    language: string;
}

type MetaLine = BeginMetaLine | EndMetaLine | LangMetaLine;

const mapMetaLine = (rawContext: RawContext): MetaLine | null => {
    //Easiest first - Is it just the end snippet line?
    const { line, index } = rawContext;
    if (line === "<!-- end snippet -->") {
        return { type: "end", index };
    }

    const langMatch = line.match(langSnippetRegex);
    if (langMatch) {
        return {
            type: "lang",
            index,
            language: langMatch.groups["lang"],
        };
    }

    const startMatch = line.match(startSnippetRegex);
    //Stack snippets inserts all these options (true/false/null) If they're not there, it's not valid.
    if (
        startMatch &&
        startMatch.groups["babel"] &&
        startMatch.groups["babelPresetReact"] &&
        startMatch.groups["babelPresetTS"] &&
        startMatch.groups["console"] &&
        startMatch.groups["hide"]
    ) {
        return {
            type: "begin",
            index,
            babel: startMatch.groups["babel"] || "null",
            babelPresetReact: startMatch.groups["babelPresetReact"] || "null",
            babelPresetTS: startMatch.groups["babelPresetTS"] || "null",
            console: startMatch.groups["console"] || "null",
            hide: startMatch.groups["hide"] || "null",
        };
    }

    return null;
};

interface ValidationResult {
    valid: boolean;
    beginIndex?: number;
    endIndex?: number;
    htmlIndex?: number;
    cssIndex?: number;
    jsIndex?: number;
    reason?: string;
}

const validateMetaLines = (metaLines: MetaLine[]): ValidationResult => {
    //We now have an ordered list of our meta lines, so...
    const validationResult: ValidationResult = {
        valid: false,
        reason: "Did not discover beginning and end",
    };
    //Validate, returning immediately on duplicates.
    for (let i = 0; i < metaLines.length; i++) {
        const m = metaLines[i];
        switch (m.type) {
            case "begin":
                if (validationResult.beginIndex)
                    return { valid: false, reason: "Duplicate Begin block" };
                validationResult.beginIndex = m.index;
                break;
            case "end":
                if (validationResult.endIndex)
                    return { valid: false, reason: "Duplicate End block" };
                validationResult.endIndex = m.index;
                break;
            case "lang":
                switch (m.language) {
                    case "js":
                        if (validationResult.jsIndex)
                            return {
                                valid: false,
                                reason: "Duplicate JS block",
                            };
                        validationResult.jsIndex = m.index;
                        break;
                    case "html":
                        if (validationResult.htmlIndex)
                            return {
                                valid: false,
                                reason: "Duplicate HTML block",
                            };
                        validationResult.htmlIndex = m.index;
                        break;
                    case "css":
                        if (validationResult.cssIndex)
                            return {
                                valid: false,
                                reason: "Duplicate CSS block",
                            };
                        validationResult.cssIndex = m.index;
                        break;
                }
                break;
        }
        //If we've encountered a start and an end without duplicates, that's all the blocks we're processing for now
        if (
            validationResult.beginIndex != null &&
            validationResult.endIndex != null
        ) {
            validationResult.valid = true;
            validationResult.reason = null;
            break;
        }
    }

    return validationResult;
};

const parseSnippetBlock: MarkdownIt.ParserBlock.RuleBlock = (
    state: MarkdownIt.StateBlock,
    startLine: number,
    endLine: number,
    silent: boolean
) => {
    // if it's indented more than 3 spaces, it should be a code block
    if (state.sCount[startLine] - state.blkIndent >= 4) {
        return false;
    }

    //Snippets cannot be indented. If they are, they're talking _about_ snippets, so ignore.
    if (state.blkIndent != 0 || state.tShift[startLine] != 0) {
        return false;
    }

    //Grab the first line and check it for our opening snippet marker
    const openingLine = state.src.slice(
        state.bMarks[startLine],
        state.eMarks[startLine]
    );
    if (!validSnippetRegex.test(openingLine)) {
        return false;
    }

    let rawMetaLines: RawContext[] = [];

    //Next up, we want to find and test all the <!-- --> blocks we find.
    for (let i = startLine; i < endLine; i++) {
        //If it's not a `<` at the beginning, fail fast
        if (state.src.charCodeAt(state.bMarks[i]) != 60) {
            continue;
        }
        const line = state.src.slice(state.bMarks[i], state.eMarks[i]);
        if (!validSnippetRegex.test(line)) {
            continue;
        }
        rawMetaLines = [...rawMetaLines, { line, index: i }];
    }

    const metaLines = rawMetaLines.map(mapMetaLine).filter((m) => m != null);
    const validationResult = validateMetaLines(metaLines);

    //We now know this is a valid snippet. Last call before we start processing
    if (silent || !validationResult.valid) {
        return validationResult.valid;
    }

    //A valid block must start with a begin and end, so cleave the opening and closing from the lines
    const begin = metaLines.shift();
    if (begin.type !== "begin") return false;
    const end = metaLines.pop();
    if (end.type !== "end") return false;

    //The rest must be langs, sort them by index
    const langSort = metaLines
        .filter((m) => m.type == "lang") //Not strictly necessary, but useful for typing
        .sort((a, b) => a.index - b.index);
    if (!langSort.every((l) => l.type === "lang")) return false;

    const openToken = state.push("stack_snippet_open", "code", 1);
    openToken.attrSet("hide", begin.hide);
    openToken.attrSet("console", begin.console);
    openToken.attrSet("babel", begin.babel);
    openToken.attrSet("babelPresetReact", begin.babelPresetReact);
    openToken.attrSet("babelPresetTS", begin.babelPresetTS);

    for (let i = 0; i < langSort.length; i++) {
        //Use the beginning of the next block to establish the end of this one, or the end of the snippet
        const langEnd =
            i + 1 == langSort.length ? end.index : langSort[i + 1].index;
        //Start after the header of the lang block (+1) and the following empty line (+1)
        //End on the beginning of the next metaLine, less the preceding empty line (-1)
        //All lang blocks are forcefully indented 4 spaces, so cleave those away.
        const langBlock = state.getLines(
            langSort[i].index + 2,
            langEnd - 1,
            4,
            false
        );
        const langToken = state.push("stack_snippet_lang", "code", 1);
        langToken.content = langBlock;
        langToken.map = [langSort[i].index, langEnd];
        langToken.attrSet("language", langSort[i].language);
    }
    state.push("stack_snippet_close", "code", -1);
    state.line = end.index + 1;
    return true;
};

export const stackSnippetRichTextNodeSpec: { [name: string]: NodeSpec } = {
    stack_snippet: {
        //It can have exactly 3 lang blocks: html, css, js.
        // These look the same, and I don't think we need to be picky about order.
        content: "stack_snippet_lang stack_snippet_lang stack_snippet_lang",
        group: "block",
        selectable: false,
        inline: false,
        defining: true,
        isolating: true,
        attrs: {
            hide: { default: "null" },
            console: { default: "null" },
            babel: { default: "null" },
            babelPresetReact: { default: "null" },
            babelPresetTS: { default: "null" },
        },
        toDOM() {
            return [
                "div",
                { class: "snippet" },
                ["div", { class: "snippet-code" }, 0],
            ];
        },
    },
    stack_snippet_lang: {
        content: "text*",
        code: true,
        defining: true,
        isolating: true,
        inline: false,
        attrs: {
            language: {
                default: "",
                validate: (value: unknown) => {
                    if (typeof value !== "string") {
                        return false;
                    }
                    return ["js", "css", "html"].includes(value);
                },
            },
        },
        toDOM(node: ProsemirrorNode) {
            const rawLang: unknown = node.attrs.language;
            let language = "";
            if (rawLang && typeof rawLang == "string") {
                language = rawLang;
            }
            return [
                "pre",
                {
                    class: `prettyprint-override snippet-code-${language} lang-${language}`,
                },
                ["code", 0],
            ];
        },
    },
};

export const stackSnippetPlugin = (md: MarkdownIt) => {
    md.block.ruler.before("fence", "stack_snippet", parseSnippetBlock);
};
