; Code folding patterns for Java

; Fold class bodies
(class_declaration
  body: (class_body) @fold)

; Fold interface bodies
(interface_declaration
  body: (interface_body) @fold)

; Fold enum bodies
(enum_declaration
  body: (enum_body) @fold)

; Fold annotation type bodies
(annotation_type_declaration
  body: (annotation_type_body) @fold)

; Fold record bodies
(record_declaration
  body: (class_body) @fold)

; Fold method bodies
(method_declaration
  body: (block) @fold)

; Fold constructor bodies
(constructor_declaration
  body: (constructor_body) @fold)

; Fold static initializers
(static_initializer
  (block) @fold)

; Fold blocks
(block) @fold

; Fold array initializers
(array_initializer) @fold

; Fold lambda expressions
(lambda_expression
  body: (block) @fold)

; Fold switch blocks
(switch_block) @fold

; Fold try statements
(try_statement
  body: (block) @fold)

; Fold catch clauses
(catch_clause
  body: (block) @fold)

; Fold finally clauses
(finally_clause
  (block) @fold)

; Fold multi-line comments
(block_comment) @fold
