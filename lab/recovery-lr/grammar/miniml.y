/* miniml, a small ML-like language, for bison 2.3. 50 productions, see ../LANGUAGE.md.
   A program is a list of top-level definitions: let [rec] name parameters = expression.
   The grammar is ambiguous as written, e.g. a + b * c and the dangling else. Every one of its 281 shift/reduce
   conflicts is settled by the precedence declarations below, and bison reports none. */
%{
int yylex(void);
void yyerror(const char *message);
%}

%token LET REC IN IF THEN ELSE FUN TRUE FALSE
%token IDENT INT STRING
%token ARROW EQ NE LT LE GT GE PLUS MINUS STAR SLASH CONS AND OR CARET
%token LPAREN RPAREN LBRACK RBRACK COMMA SEMI UNDERSCORE
/* What the scanner returns for text that is no token of the language. No rule has them. */
%token BADCHAR BADSTRING BADCOMMENT

/* Lowest first. LOWEST is the precedence of the rules whose last expression goes on as far as it can:
   let .. in e, fun .. -> e, if .. then e, if .. then e else e. */
%nonassoc LOWEST
%nonassoc ELSE
%right OR
%right AND
%left EQ NE LT LE GT GE
%right CARET
%right CONS
%left PLUS MINUS
%left STAR SLASH
%nonassoc UMINUS

%%

program
  : definitions
  ;

definitions
  : /* empty */
  | definitions definition
  ;

definition
  : LET binding
  | LET REC binding
  ;

binding
  : IDENT parameters EQ expr
  | UNDERSCORE EQ expr
  | LPAREN RPAREN EQ expr
  ;

parameters
  : /* empty */
  | parameters parameter
  ;

parameter
  : IDENT
  | UNDERSCORE
  | LPAREN RPAREN
  ;

expr
  : LET binding IN expr                 %prec LOWEST
  | LET REC binding IN expr             %prec LOWEST
  | FUN parameter parameters ARROW expr %prec LOWEST
  | IF expr THEN expr                   %prec LOWEST
  | IF expr THEN expr ELSE expr         %prec LOWEST
  | expr OR expr
  | expr AND expr
  | expr EQ expr
  | expr NE expr
  | expr LT expr
  | expr LE expr
  | expr GT expr
  | expr GE expr
  | expr CARET expr
  | expr CONS expr
  | expr PLUS expr
  | expr MINUS expr
  | expr STAR expr
  | expr SLASH expr
  | MINUS expr                          %prec UMINUS
  | application
  ;

application
  : atom
  | application atom
  ;

atom
  : INT
  | STRING
  | IDENT
  | TRUE
  | FALSE
  | LPAREN RPAREN
  | LPAREN expr RPAREN
  | LPAREN expr COMMA tuple_rest RPAREN
  | LBRACK RBRACK
  | LBRACK elements RBRACK
  ;

tuple_rest
  : expr
  | tuple_rest COMMA expr
  ;

elements
  : expr
  | elements SEMI expr
  ;

%%
