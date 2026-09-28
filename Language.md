# Module system
The module system forms a forest of filesystem trees where a tree root is called a *package*. Every package subdirectory with its immediately pertaining files is termed a *module*. Package root directory is also a module.

Order of declarations (functions, let bindings, classes and axioms) in a MetaCaCaOML file is insignificant: an item can reference any identifier declared positionally-above or positionally-below it. More than that: declared identifiers are collected from all files immediately pertaining to a module (directory), so an item in one file can reference an identifier declared in another file in the same module without imports.

This principle does not extend to operators: they must be declared positionally-above use or imported, even for files within module boundary. Lifting this restriction would require introducing more parsing stages, so I forgo it.

Two declarations in a module shall not introduce the same identifier or operator.

## Import statements
An `open` statement imports both identifiers and operators from another module to be used in current file. Its argument is a package name followed by a filesystem path from package root to a directory (module) within that package. Imported identifiers and operators are not exported and are not made available to other files of current module.
```
# Import operators and identifiers from all files `bar/baz/*.meml` in package `foo`.
open foo:bar/baz/
```

An `open infix` statement only imports operators and targets an individual file in a package. It's useful to import operators within a module since they are not added to module's shared namespace.
```
# Import operators from file `bar/baz/zap.meml` from package `foo`.
open infix foo:bar/baz/zap.meml
```

Cyclic imports between modules are admitted.