; Based on tree-sitter-java tags.scm
; Adapted for Nova's symbol roles

; Class declarations
(class_declaration
  name: (identifier) @name) @subtree
  (#set! role class)

; Interface declarations
(interface_declaration
  name: (identifier) @name) @subtree
  (#set! role interface)

; Enum declarations
(enum_declaration
  name: (identifier) @name) @subtree
  (#set! role enum)

; Record declarations
(record_declaration
  name: (identifier) @name) @subtree
  (#set! role class)

; Annotation type declarations
(annotation_type_declaration
  name: (identifier) @name) @subtree
  (#set! role interface)

; Method declarations
(method_declaration
  name: (identifier) @name) @subtree
  (#set! role method)

; Constructor declarations
(constructor_declaration
  name: (identifier) @name) @subtree
  (#set! role constructor)

; Field declarations
(field_declaration
  declarator: (variable_declarator
    name: (identifier) @name)) @subtree
  (#set! role property)

; Enum constants
(enum_constant
  name: (identifier) @name) @subtree
  (#set! role constant)

; Interface constants
(constant_declaration
  declarator: (variable_declarator
    name: (identifier) @name)) @subtree
  (#set! role constant)

; Package declaration
(package_declaration
  (scoped_identifier) @name) @subtree
  (#set! role package)
