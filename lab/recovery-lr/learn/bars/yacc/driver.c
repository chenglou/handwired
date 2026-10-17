/* The reference of the bar "yacc error productions": bison's generated parser for miniml-errors.y with flex's
   generated scanner for ../../../grammar/miniml.l, built into one program with two commands. It is
   ../../../grammar/driver.c with the steps of bison's error recovery in the trace.
     driver tables                      prints the arrays of the generated parser as JSON
     driver run <input.bin> <out.txt>   for every record (4 bytes of length, lowest first, then the bytes) prints one line:
       P E<state> T<symbol>@<start> S:<name> R<rule> X O:<name> D:<name> ... =<result>
                                        what yyparse did, in order: a state entered, a token read, a symbol shifted
                                        (a token, or `error`), a reduction, the call of yyerror, a symbol popped
                                        from the stack by the recovery, a token discarded by the recovery, and the
                                        value that yyparse returned
   The trace comes from bison's own debug output (YYDEBUG), through YYFPRINTF. build.ts compiles this file next to
   the generated miniml.tab.c and lex.yy.c. */
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

/* The letter of the step whose symbol the next "token %s (" or "nterm %s (" names, 0 for none. bison prints a
   step as a title, e.g. "Shifting", and then the symbol. */
static char pending_step = 0;

static int trace_printf(FILE *stream, const char *format, ...) {
  va_list arguments;
  (void)stream;
  va_start(arguments, format);
  if (strncmp(format, "Entering state %d", 17) == 0) fprintf(out, " E%d", va_arg(arguments, int));
  else if (strncmp(format, "Reducing stack by rule %d", 25) == 0) fprintf(out, " R%d", va_arg(arguments, int));
  else if (strcmp(format, "%s ") == 0) {
    const char *title = va_arg(arguments, const char *);
    if (strcmp(title, "Shifting") == 0) pending_step = 'S';
    else if (strcmp(title, "Error: discarding") == 0) pending_step = 'D';
    else if (strcmp(title, "Error: popping") == 0) pending_step = 'O';
    else pending_step = 0;
  } else if (strcmp(format, "token %s (") == 0 || strcmp(format, "nterm %s (") == 0) {
    if (pending_step != 0) fprintf(out, " %c:%s", pending_step, va_arg(arguments, const char *));
    pending_step = 0;
  }
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
  int index;
  printf("{\n");
  printf("\"YYFINAL\": %d, \"YYLAST\": %d, \"YYNTOKENS\": %d, \"YYNNTS\": %d, \"YYNRULES\": %d, \"YYNSTATES\": %d,\n", YYFINAL, YYLAST, YYNTOKENS, YYNNTS, YYNRULES, YYNSTATES);
  printf("\"YYPACT_NINF\": %d, \"YYTABLE_NINF\": %d, \"YYTERROR\": %d,\n", YYPACT_NINF, YYTABLE_NINF, YYTERROR);
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
    int result;
    if (length + 1 > capacity) { capacity = length + 1; bytes = realloc(bytes, capacity); }
    if (length > 0 && fread(bytes, 1, length, input) != length) { fprintf(stderr, "a record is cut off\n"); return 2; }
    buffer = yy_scan_bytes(bytes, (int)length);
    scan_offset = 0;
    pending_step = 0;
    fprintf(out, "P");
    result = yyparse();
    fprintf(out, " =%d\n", result);
    yy_delete_buffer(buffer);
  }
  fclose(out);
  fclose(input);
  return 0;
}
