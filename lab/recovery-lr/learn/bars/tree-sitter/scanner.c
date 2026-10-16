/* The scanner of the tree-sitter grammar: flex's table for miniml.l, as ../../../parser.ts runs it. tree-sitter calls
   it for every token, and it gives the token that flex gives, whatever the parser can take at that place. So the
   parser reads the same tokens as bison's parser, in valid and in broken text.

   scanner-tables.h is written by build.ts from grammar/tables.json:
     scanner_start, scanner_class_count
     scanner_class_of_byte[256]        the class of a byte; a code point from U+0080 up is read as the byte 0x80
     scanner_next[state * scanner_class_count + class]   the next state, 0 or less where the token ends
     scanner_token_of_state[state]     the token that ends in the state, as its place in the grammar's `externals` */
#include "tree_sitter/parser.h"
#include "scanner-tables.h"

void *tree_sitter_miniml_external_scanner_create(void) { return NULL; }
void tree_sitter_miniml_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_miniml_external_scanner_serialize(void *payload, char *buffer) { (void)payload; (void)buffer; return 0; }
void tree_sitter_miniml_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) { (void)payload; (void)buffer; (void)length; }

bool tree_sitter_miniml_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  int state = scanner_start;
  (void)payload;
  /* The parser says which tokens it can take here. The scanner does not look: flex does not know either. */
  (void)valid_symbols;
  /* White space is no token for tree-sitter. flex's two rules for it take runs of exactly these four. */
  while (!lexer->eof(lexer) && (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\r' || lexer->lookahead == '\n')) lexer->advance(lexer, true);
  /* At the end of the text tree-sitter's own scanner gives the end. */
  if (lexer->eof(lexer)) return false;
  while (!lexer->eof(lexer)) {
    int32_t code_point = lexer->lookahead;
    int next = scanner_next[state * scanner_class_count + scanner_class_of_byte[code_point >= 0 && code_point < 0x80 ? code_point : 0x80]];
    if (next <= 0) break;
    lexer->advance(lexer, false);
    state = next;
  }
  lexer->mark_end(lexer);
  lexer->result_symbol = (TSSymbol)scanner_token_of_state[state];
  return true;
}
