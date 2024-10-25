# MetaCaCaOML
is a procedural language designed for general-purpose and systems programming. By combining the imperative paradigm with an advanced type system, it provides a way to express data-oriented algorithms which are also highly polymorphic and generic.

Its core features:
| Feature | Haskell equivalent | Implementation status |
| - | - | - |
| Some kind of System F derivative | ⟻ | ✅ |
| Classes | Data types | ✅ |
| Delimited continuations | ⟻ | ❌ |
| Seeds | Implicit variables | ❌ |
| Interfaces | Typeclasses | ❌ |
| Compilation-time metaprogramming | Templates | ❌ |

For code samples see ./main.js and  ./memlstd.js

## The Idea
Minimizing the feature set is a popular criteria in designing languages. In MetaCaCaOML I tried to derive a minimal set of features while still yielding a concise and expressive language with good ergonomics because it is a fun challenge in building abstractions.

Initially, what inspired me on this quest for min-max expressiveness was how in low-level languages like C++ and Rust, GC could be implemented in a third-party library with no compiler modification.

After that I researched for ways to do the same with green-threads (another high-level feature akin to GC) and discovered delimited continuations, which conveniently also subsume exception handling. Then finally I arrived at [this article by Li-yao Xia](https://blog.poisson.chat/posts/2023-01-02-del-cont-examples.html) detailing a mechanism for expressing algebraic effects through del conts and what appears to be implicit variables. At this point I decided to throw these concepts together and see what patterns will emerge while coding in this experimental language.