; Based on tree-sitter-java official queries
; Adapted for Nova's highlight groups

; Methods
(method_declaration
  name: (identifier) @identifier.method)

(method_invocation
  name: (identifier) @identifier.method)

(super) @keyword.self

; Annotations
(annotation
  name: (identifier) @identifier.decorator)

(marker_annotation
  name: (identifier) @identifier.decorator)

"@" @operator

; Types
(type_identifier) @identifier.type

(interface_declaration
  name: (identifier) @identifier.type.protocol)

(class_declaration
  name: (identifier) @identifier.type.class)

(enum_declaration
  name: (identifier) @identifier.type.enum)

(record_declaration
  name: (identifier) @identifier.type.class)

; Type references with uppercase naming convention
((field_access
  object: (identifier) @identifier.type)
 (#match? @identifier.type "^[A-Z]"))

((scoped_identifier
  scope: (identifier) @identifier.type)
 (#match? @identifier.type "^[A-Z]"))

((method_invocation
  object: (identifier) @identifier.type)
 (#match? @identifier.type "^[A-Z]"))

((method_reference
  . (identifier) @identifier.type)
 (#match? @identifier.type "^[A-Z]"))

(constructor_declaration
  name: (identifier) @identifier.type)

; Primitive types
[
  (boolean_type)
  (integral_type)
  (floating_point_type)
  (void_type)
] @identifier.core

; Constants (ALL_CAPS naming)
((identifier) @identifier.constant
 (#match? @identifier.constant "^_*[A-Z][A-Z\\d_]+$"))

; Built-in
(this) @keyword.self

; Literals
[
  (hex_integer_literal)
  (decimal_integer_literal)
  (octal_integer_literal)
  (binary_integer_literal)
  (decimal_floating_point_literal)
  (hex_floating_point_literal)
] @value.number

[
  (character_literal)
  (string_literal)
] @string

(escape_sequence) @string.escape

[
  (true)
  (false)
] @value.boolean

(null_literal) @value.null

[
  (line_comment)
  (block_comment)
] @comment

; Keywords
[
  "abstract"
  "assert"
  "break"
  "case"
  "catch"
  "class"
  "continue"
  "default"
  "do"
  "else"
  "enum"
  "exports"
  "extends"
  "final"
  "finally"
  "for"
  "if"
  "implements"
  "import"
  "instanceof"
  "interface"
  "module"
  "native"
  "new"
  "non-sealed"
  "open"
  "opens"
  "package"
  "permits"
  "private"
  "protected"
  "provides"
  "public"
  "requires"
  "record"
  "return"
  "sealed"
  "static"
  "strictfp"
  "switch"
  "synchronized"
  "throw"
  "throws"
  "to"
  "transient"
  "transitive"
  "try"
  "uses"
  "volatile"
  "when"
  "while"
  "with"
  "yield"
] @keyword

; Operators
[
  "="
  ">"
  "<"
  "!"
  "~"
  "?"
  ":"
  "=="
  "<="
  ">="
  "!="
  "&&"
  "||"
  "++"
  "--"
  "+"
  "-"
  "*"
  "/"
  "&"
  "|"
  "^"
  "%"
  "<<"
  ">>"
  ">>>"
  "+="
  "-="
  "*="
  "/="
  "&="
  "|="
  "^="
  "%="
  "<<="
  ">>="
  ">>>="
  "->"
  "::"
] @operator

; Brackets
[
  "("
  ")"
  "{"
  "}"
  "["
  "]"
] @bracket

; Variables
(local_variable_declaration
  declarator: (variable_declarator
    name: (identifier) @identifier.variable))

(formal_parameter
  name: (identifier) @identifier.variable)

(catch_formal_parameter
  name: (identifier) @identifier.variable)

(enhanced_for_statement
  name: (identifier) @identifier.variable)

(lambda_expression
  parameters: (identifier) @identifier.variable)

(lambda_expression
  parameters: (inferred_parameters
    (identifier) @identifier.variable))
