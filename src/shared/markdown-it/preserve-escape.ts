import MarkdownIt, { StateInline } from "markdown-it";

function buildPreserveEscapeFn(
    md: MarkdownIt
): MarkdownIt.ParserInline.RuleInline {
    const [escapeFn] = md.inline.ruler
        .getRules("")
        .filter((r) => r.name === "escape");

    const noop = (): boolean => false;
    //The "escape" rule has been disabled or otherwise removed; so there's nothing to replace here.
    if (!escapeFn) {
        return noop;
    }
    return function preserveEscapeFn(
        state: StateInline,
        silent: boolean
    ): boolean {
        const escRet = escapeFn(state, silent);

        //If the rule did nothing (returned false or is running in silent mode) there's nothing to fix
        if (silent || escRet === false) return escRet;

        //The escape rule, if executed, always adds a 'text_special' node with 'escape', and we're going to work on that.
        const escapeToken = state.tokens.findLast((t) => t.info == "escape");

        if (escapeToken) {
            //Now we want to retag the type so that
            // - the escape token is ignored by the text_merge
            // - We can enact custom rendering later
            escapeToken.type = "escape";
        }

        return escRet;
    };
}

/***
 * Preserves `text_special` nodes marked as `escape` by changing their type to `escape`
 *  allowing us to preserve the escape characters and parse them downstream.
 */
export function preserve_escape(md: MarkdownIt): void {
    const preserveEscapeTokens = buildPreserveEscapeFn(md);
    md.inline.ruler.at("escape", preserveEscapeTokens);
}
