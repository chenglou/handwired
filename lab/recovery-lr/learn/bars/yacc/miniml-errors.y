/* miniml with error productions, for bison 2.3, for the bar "yacc error productions": ../../../grammar/miniml.y
   with 27 rules added by hand, and the 3 rules of `binding` a second time as `local_binding`. The tokens and the
   precedences are the base grammar's, so every terminal has the number that it has there. README.md says what the
   rules are for and how they were chosen.

   Three sorts of added rules:
   - "junk": rules with the token `error` for text that the parser passes over. bison gives a state that can shift
     `error` no default reduction, so with these rules the parser also notices an error before it has reduced
     half of the stack away.
   - "repair": rules with `error` in the place of something that is missing, e.g. a `=`. The token at which the
     error was met is read again right after `error`, so such a rule only applies where that token fits.
   - "unfinished": rules without `error` for a construct whose end is missing, e.g. `( expr` without its `)`.
     The parser reduces by them at a token that can follow an expression and cannot go on with the construct.
     A compiler would report the error in the rule's action.

   `local_binding` is `binding` for a `let` inside an expression, with the same rules. With a nonterminal of its
   own, the end of a definition at the top and the end of a local one are two states, with two sets of tokens that
   may follow: a stray `)` after a definition at the top is passed over, and after a local one it ends the `let`.

   bison counts 157 shift/reduce conflicts, all between a shift and a reduction by a rule that can now be followed
   by more tokens than in the base grammar. Each is settled as a shift, which is bison's default and what the base
   grammar does in the same place: check.ts walks both automata and finds the base parser's action wherever a
   valid program can be. */
%{
int yylex(void);
void yyerror(const char *message);
%}

%token LET REC IN IF THEN ELSE FUN TRUE FALSE
%token IDENT INT STRING
%token ARROW EQ NE LT LE GT GE PLUS MINUS STAR SLASH CONS AND OR CARET
%token LPAREN RPAREN LBRACK RBRACK COMMA SEMI UNDERSCORE
%token BADCHAR BADSTRING BADCOMMENT

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

%expect 157

%%

program
  : definitions
  ;

definitions
  : /* empty */
  | definitions definition
  | definitions error                   /* junk: text before a definition is passed over up to the next `let` */
  ;

definition
  : LET binding
  | LET REC binding
  | error EQ expr                       /* repair: `let name parameters` is unreadable, e.g. `lte x = 1` */
  ;

binding
  : IDENT parameters EQ expr
  | UNDERSCORE EQ expr
  | LPAREN RPAREN EQ expr
  | error EQ expr                       /* repair: the name is unreadable, e.g. `let 5 = 1`: go on at the `=` */
  | IDENT parameters error expr         /* repair: the `=` is missing or junk stands before it, e.g. `let f x 1` */
  | IDENT parameters                    /* unfinished: the next definition follows the parameters */
  ;

/* The same rules for a `let` inside an expression. The lowest precedence keeps an operator after the expression a
   part of the expression, as in the base grammar, where no operator can follow a binding. */
local_binding
  : IDENT parameters EQ expr            %prec LOWEST
  | UNDERSCORE EQ expr                  %prec LOWEST
  | LPAREN RPAREN EQ expr               %prec LOWEST
  | error EQ expr                       %prec LOWEST
  | IDENT parameters error expr         %prec LOWEST
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
  : LET local_binding IN expr           %prec LOWEST
  | LET REC local_binding IN expr       %prec LOWEST
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
  | expr error                          /* junk: text after an expression is passed over */
  | expr error THEN expr                %prec LOWEST   /* repair: the `if` is missing, e.g. `x > 0 then 1 else 2` */
  | expr error THEN expr ELSE expr      %prec LOWEST
  | expr error ELSE expr                %prec LOWEST   /* repair: `if condition then` is missing, e.g. `1 else 2` */
  | expr error IN expr                  %prec LOWEST   /* repair: the `let` of a local definition is missing, e.g. `y = 1 in y` */
  | LET local_binding                   %prec LOWEST   /* unfinished: a local definition without `in` */
  | LET REC local_binding               %prec LOWEST
  | IF expr                             %prec LOWEST   /* unfinished: an `if` without `then` */
  | IF expr ELSE expr                   %prec LOWEST   /* unfinished: an `if` without `then expression` */
  | FUN error ARROW expr                %prec LOWEST   /* repair: the parameters are unreadable: go on at the `->` */
  | FUN parameter parameters error expr %prec LOWEST   /* repair: the `->` is missing or junk stands before it */
  ;

application
  : atom
  | application atom
  /* unfinished: an `if` or a `fun` as an argument, e.g. `f if a then b else c`. Something is missing before it:
     brackets, an operator, `in` or `else`. */
  | application IF expr THEN expr                   %prec LOWEST
  | application IF expr THEN expr ELSE expr         %prec LOWEST
  | application FUN parameter parameters ARROW expr %prec LOWEST
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
  | error                               /* junk: text where an expression has to come, e.g. the `)` of `1 + )` */
  | BADSTRING                           /* unfinished: a string that is not closed is a string */
  | LPAREN expr                         /* unfinished: a `)` is missing */
  | LPAREN expr COMMA tuple_rest
  | LBRACK elements                     /* unfinished: a `]` is missing */
  ;

tuple_rest
  : expr
  | tuple_rest COMMA expr
  ;

elements
  : expr
  | elements SEMI expr
  | elements COMMA expr                 /* unfinished: a `,` between the elements of a list, e.g. `[1, 2]` */
  ;

%%
