# 1. Shallow `switch`-`case` indentation
`case` labels are on same indentation level as `switch`. Lines after `case` gain 1 level of indentation.

# 2. Braces after `case`
Braces are placed to lexically scope variables.

Proper formatting example:
```
switch (foo) {
case 1:
	console.log("foo == 1")
case 2: {
	let message = "foo == 1"
	console.log(message)
}
}
```