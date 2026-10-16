/* The reference: bison's generated parser and flex's generated scanner, built into one program with two commands.
     driver tables                      prints the arrays of the two generated files as JSON
     driver run <input.bin> <out.txt>   for every record (4 bytes of length, lowest first, then the bytes) prints two lines:
       L <kind>@<start>+<length> ...    every token of the scanner, white space and comments included
       P E<state> T<symbol>@<start> R<rule> ... X? =<result>   what yyparse did, in order: a state entered, a token
                                        read, a reduction, the call of yyerror, and the value that yyparse returned
   The parser's trace comes from bison's own debug output (YYDEBUG), through YYFPRINTF. build.ts compiles this file
   next to the generated miniml.tab.c and lex.yy.c. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

int token_start = 0, scan_offset = 0;
static FILE *out;

static int trace_printf(FILE *stream, const char *format, ...);
#define YYDEBUG 1
#define YYFPRINTF trace_printf
#include "miniml.tab.c"
#include "lex.yy.c"

static int trace_printf(FILE *stream, const char *format, ...) {
  va_list arguments;
  (void)stream;
  va_start(arguments, format);
  if (strncmp(format, "Entering state %d", 17) == 0) fprintf(out, " E%d", va_arg(arguments, int));
  else if (strncmp(format, "Reducing stack by rule %d", 25) == 0) fprintf(out, " R%d", va_arg(arguments, int));
  va_end(arguments);
  return 0;
}

static int is_trivia(int token) { return token == WHITESPACE || token == NEWLINE || token == COMMENT; }

int yylex(void) {
  for (;;) {
    int token = raw_lex();
    if (is_trivia(token)) continue;
    if (token <= 0) fprintf(out, " T0@%d", scan_offset);
    else fprintf(out, " T%d@%d", YYTRANSLATE(token), token_start);
    return token;
  }
}

void yyerror(const char *message) { (void)message; fprintf(out, " X"); }

static void print_ints(const char *name, const int *values, int count) {
  int index;
  printf("\"%s\": [", name);
  for (index = 0; index < count; index++) printf("%s%d", index ? "," : "", values[index]);
  printf("],\n");
}
#define PRINT_TABLE(name, table) do { \
  int count = (int)(sizeof(table) / sizeof(table[0])), index; \
  int *copy = malloc(sizeof(int) * (size_t)count); \
  for (index = 0; index < count; index++) copy[index] = (int)table[index]; \
  print_ints(name, copy, count); free(copy); } while (0)

static void print_tables(void) {
  int state, column, index;
  int scanner_states = (int)(sizeof(yy_nxt) / sizeof(yy_nxt[0]));
  int scanner_classes = (int)(sizeof(yy_nxt[0]) / sizeof(yy_nxt[0][0]));
  printf("{\n");
  printf("\"YYFINAL\": %d, \"YYLAST\": %d, \"YYNTOKENS\": %d, \"YYNNTS\": %d, \"YYNRULES\": %d, \"YYNSTATES\": %d,\n", YYFINAL, YYLAST, YYNTOKENS, YYNNTS, YYNRULES, YYNSTATES);
  printf("\"YYPACT_NINF\": %d, \"YYTABLE_NINF\": %d,\n", YYPACT_NINF, YYTABLE_NINF);
  PRINT_TABLE("yypact", yypact);
  PRINT_TABLE("yydefact", yydefact);
  PRINT_TABLE("yypgoto", yypgoto);
  PRINT_TABLE("yydefgoto", yydefgoto);
  PRINT_TABLE("yytable", yytable);
  PRINT_TABLE("yycheck", yycheck);
  PRINT_TABLE("yyr1", yyr1);
  PRINT_TABLE("yyr2", yyr2);
  PRINT_TABLE("yystos", yystos);
  PRINT_TABLE("yyprhs", yyprhs);
  PRINT_TABLE("yyrhs", yyrhs);
  printf("\"yytname\": [");
  for (index = 0; index < YYNTOKENS + YYNNTS; index++) printf("%s\"%s\"", index ? "," : "", yytname[index]);
  printf("],\n");
  printf("\"scannerStates\": %d, \"scannerClasses\": %d, \"scannerRules\": %d,\n", scanner_states, scanner_classes, YY_NUM_RULES - 1);
  PRINT_TABLE("yy_ec", yy_ec);
  PRINT_TABLE("yy_accept", yy_accept);
  /* The state after a byte 0 in every state, 0 for none. The generated scanner reads a byte 0 with a function of
     its own, since a 0 also ends its buffer. */
  printf("\"yy_NUL_trans\": [");
  for (state = 0; state < scanner_states; state++) printf("%s%d", state ? "," : "", (int)yy_try_NUL_trans(state));
  printf("],\n");
  printf("\"yy_nxt\": [");
  for (state = 0; state < scanner_states; state++)
    for (column = 0; column < scanner_classes; column++) printf("%s%d", state + column ? "," : "", (int)yy_nxt[state][column]);
  printf("]\n}\n");
}

int main(int argc, char **argv) {
  FILE *input;
  unsigned char header[4];
  char *bytes = NULL;
  size_t capacity = 0;
  if (argc == 2 && strcmp(argv[1], "tables") == 0) { print_tables(); return 0; }
  if (argc != 4 || strcmp(argv[1], "run") != 0) { fprintf(stderr, "usage: driver tables | driver run <input.bin> <out.txt>\n"); return 2; }
  input = fopen(argv[2], "rb");
  out = fopen(argv[3], "w");
  if (!input || !out) { fprintf(stderr, "cannot open a file\n"); return 2; }
  yydebug = 1;
  while (fread(header, 1, 4, input) == 4) {
    size_t length = (size_t)header[0] | ((size_t)header[1] << 8) | ((size_t)header[2] << 16) | ((size_t)header[3] << 24);
    YY_BUFFER_STATE buffer;
    int token, result;
    if (length + 1 > capacity) { capacity = length + 1; bytes = realloc(bytes, capacity); }
    if (length > 0 && fread(bytes, 1, length, input) != length) { fprintf(stderr, "a record is cut off\n"); return 2; }
    /* The scanner alone. */
    buffer = yy_scan_bytes(bytes, (int)length);
    scan_offset = 0;
    fprintf(out, "L");
    while ((token = raw_lex()) > 0) fprintf(out, " %d@%d+%d", is_trivia(token) ? token : YYTRANSLATE(token), token_start, (int)yyleng);
    fprintf(out, "\n");
    yy_delete_buffer(buffer);
    /* The parser. */
    buffer = yy_scan_bytes(bytes, (int)length);
    scan_offset = 0;
    fprintf(out, "P");
    result = yyparse();
    fprintf(out, " =%d\n", result);
    yy_delete_buffer(buffer);
  }
  fclose(out);
  fclose(input);
  return 0;
}
