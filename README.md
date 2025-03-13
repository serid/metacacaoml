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

For code samples see `./test.meml.rs` and `./std.meml.rs`

## The Big Idea
I find myself compelled by the procedural paradigm where programs are composed of data structures and imperative algorithms mutating them. This paradigm is well-supported among existing languages, which also facilitate higher-order functions — an indispensable tool for encoding abstract algorithms. At the same time, these languages often include effectful features such as exceptions, generator and async functions, which cannot be used inside lambdas, limiting their composition with higher-order functions. For example:

```typescript
let urls: string[] = ["example.net", "google.com", "wikipedia.org"]
// error: `every` is a higher-order function, but it only accepts plain non-async lambdas
let all_ok: boolean = urls.every(async url => (await fetch(url)).ok)
```

There were devised plenty ways to alleviate such vexation. MetaCaCaOML employs algebraic effects, as described in [this article by Li-yao Xia](https://blog.poisson.chat/posts/2023-01-02-del-cont-examples.html), to address this limitation. Although this approach may seem low-level and unwieldy, only compiler machinery necessary to support it are delimited continuations, which are relatively easy to implement compared to a full-fledged algebraic effect system as found in Koka. In this spirit, MetaCaCaOML borrows many features from Haskell but is designed as a procedural language with minimal feature set, avoiding complications of OOP and pure FP.