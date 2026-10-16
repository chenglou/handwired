/* Runs tree-sitter's parser for miniml on many texts in one process, and prints every tree as numbers.
     driver symbols                  prints one line per symbol of the language: its number and its name
     driver trees < texts > trees    for every text one line, see below
     driver text < texts             for every text its tree as tree-sitter prints it, for a reader
   The texts come as records: the number of code points as 4 bytes, lowest first, then every code point as 4 bytes.
   A line of trees is: the number of nodes, then for every node, parent before children and children in text order,
   five numbers: the symbol, the first code point, the code point after the last one, the number of children, and
   flags (1 for a node that the parser put in itself and that holds no text, which tree-sitter calls missing,
   2 for a comment, 4 for an error node).

   The parser reads UTF-8, and the tables of the scanner read every code point from U+0080 up as one byte. So a
   code point from U+0080 up is handed to the parser as U+0080, and the places in the output are code points.
   build.ts compiles this file with the generated parser.c, scanner.c and libtree-sitter. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <tree_sitter/api.h>

const TSLanguage *tree_sitter_miniml(void);

static int read_count(FILE *in, int *count) {
  unsigned char bytes[4];
  if (fread(bytes, 1, 4, in) != 4) return 0;
  *count = (int)bytes[0] | ((int)bytes[1] << 8) | ((int)bytes[2] << 16) | ((int)bytes[3] << 24);
  return 1;
}

int main(int argc, char **argv) {
  const TSLanguage *language = tree_sitter_miniml();
  TSParser *parser;
  char *text = NULL;
  int *code_point_of_byte = NULL;
  int capacity = 0, code_point_count, as_text;
  if (argc == 2 && strcmp(argv[1], "symbols") == 0) {
    unsigned symbol;
    for (symbol = 0; symbol < ts_language_symbol_count(language); symbol++) printf("%u %s\n", symbol, ts_language_symbol_name(language, (TSSymbol)symbol));
    /* The error node's symbol is not among the language's own. */
    printf("%u ERROR\n", (unsigned)(TSSymbol)-1);
    return 0;
  }
  if (argc != 2 || (strcmp(argv[1], "trees") != 0 && strcmp(argv[1], "text") != 0)) {
    fprintf(stderr, "usage: driver symbols | driver trees < texts | driver text < texts\n");
    return 2;
  }
  as_text = strcmp(argv[1], "text") == 0;
  parser = ts_parser_new();
  if (!ts_parser_set_language(parser, language)) {
    fprintf(stderr, "the library does not take the generated parser\n");
    return 2;
  }
  while (read_count(stdin, &code_point_count)) {
    int index, byte_count = 0, node_count = 0;
    TSTree *tree;
    TSTreeCursor cursor;
    if (code_point_count < 0 || code_point_count > (1 << 24)) {
      fprintf(stderr, "a record of %d code points\n", code_point_count);
      return 2;
    }
    if (code_point_count * 2 + 1 > capacity) {
      capacity = code_point_count * 2 + 1;
      text = realloc(text, (size_t)capacity);
      code_point_of_byte = realloc(code_point_of_byte, sizeof(int) * (size_t)capacity);
    }
    for (index = 0; index < code_point_count; index++) {
      int code_point;
      if (!read_count(stdin, &code_point)) {
        fprintf(stderr, "the input ends inside a record\n");
        return 2;
      }
      code_point_of_byte[byte_count] = index;
      if (code_point >= 0 && code_point < 0x80) text[byte_count++] = (char)code_point;
      else {
        /* U+0080 as UTF-8. */
        text[byte_count++] = (char)0xC2;
        code_point_of_byte[byte_count] = index;
        text[byte_count++] = (char)0x80;
      }
    }
    code_point_of_byte[byte_count] = code_point_count;
    ts_parser_reset(parser);
    tree = ts_parser_parse_string(parser, NULL, text, (uint32_t)byte_count);
    if (tree == NULL) {
      fprintf(stderr, "the parser gave no tree\n");
      return 2;
    }
    if (as_text) {
      char *string = ts_node_string(ts_tree_root_node(tree));
      printf("%s\n", string);
      free(string);
      ts_tree_delete(tree);
      continue;
    }
    /* Twice over the tree in the same order: once to count the nodes, once to print them. */
    for (int pass = 0; pass < 2; pass++) {
      cursor = ts_tree_cursor_new(ts_tree_root_node(tree));
      if (pass == 1) printf("%d", node_count);
      for (;;) {
        TSNode node = ts_tree_cursor_current_node(&cursor);
        if (pass == 0) node_count++;
        else {
          int flags = (ts_node_is_missing(node) ? 1 : 0) | (ts_node_is_extra(node) ? 2 : 0) | (ts_node_is_error(node) ? 4 : 0);
          printf(" %u %d %d %u %d", (unsigned)ts_node_symbol(node), code_point_of_byte[ts_node_start_byte(node)], code_point_of_byte[ts_node_end_byte(node)], ts_node_child_count(node), flags);
        }
        if (ts_tree_cursor_goto_first_child(&cursor)) continue;
        while (!ts_tree_cursor_goto_next_sibling(&cursor)) {
          if (!ts_tree_cursor_goto_parent(&cursor)) goto done;
        }
      }
      done:
      ts_tree_cursor_delete(&cursor);
    }
    printf("\n");
    ts_tree_delete(tree);
  }
  ts_parser_delete(parser);
  free(text);
  free(code_point_of_byte);
  return 0;
}
