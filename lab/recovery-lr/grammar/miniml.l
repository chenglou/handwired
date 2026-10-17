/* The scanner of miniml, for flex 2.6.4. Build with -Cfe -8 -b, see build.ts.
   Every rule is one line "pattern  return NAME;", so that build.ts can read the names of the rules in order.
   Every prefix of a token is itself a token, e.g. an open string is BADSTRING, so the scanner never backs up:
   a token ends at the first byte that its state has no move for. */
%option noyywrap nounput noinput
%{
#include "miniml.tab.h"
/* Kinds that the parser never sees. */
#define WHITESPACE 1001
#define NEWLINE 1002
#define COMMENT 1003
extern int token_start, scan_offset;
#define YY_USER_ACTION token_start = scan_offset; scan_offset += yyleng;
#define YY_DECL int raw_lex(void)
%}

%%
"let"                                   return LET;
"rec"                                   return REC;
"in"                                    return IN;
"if"                                    return IF;
"then"                                  return THEN;
"else"                                  return ELSE;
"fun"                                   return FUN;
"true"                                  return TRUE;
"false"                                 return FALSE;
"_"                                     return UNDERSCORE;
[A-Za-z_][A-Za-z0-9_']*                 return IDENT;
[0-9]+                                  return INT;
\"([^"\\\n]|\\[^\n])*\"                 return STRING;
\"([^"\\\n]|\\[^\n])*\\?                return BADSTRING;
"(*"([^*]|\*+[^*)])*\*+")"              return COMMENT;
"(*"([^*]|\*+[^*)])*\**                 return BADCOMMENT;
"->"                                    return ARROW;
"="                                     return EQ;
"<>"                                    return NE;
"<"                                     return LT;
"<="                                    return LE;
">"                                     return GT;
">="                                    return GE;
"+"                                     return PLUS;
"-"                                     return MINUS;
"*"                                     return STAR;
"/"                                     return SLASH;
"::"                                    return CONS;
"&&"                                    return AND;
"||"                                    return OR;
"^"                                     return CARET;
"("                                     return LPAREN;
")"                                     return RPAREN;
"["                                     return LBRACK;
"]"                                     return RBRACK;
","                                     return COMMA;
";"                                     return SEMI;
\n                                      return NEWLINE;
[ \t\r]+                                return WHITESPACE;
.                                       return BADCHAR;
%%
