# find src -type f \
# 	-not -path '.git' \
# 	-not -path 'npins' \
# 	-not -path 'node_modules' \
# 	-not -path 'package-lock.json' \
# 	-exec sed -i -E 's/\s$//g; :A; s/^(\t*)(  )/\1\t/; tA' {} +

fd --unrestricted --ignore-vcs --type file \
	--exclude .git/ \
	--exclude node_modules/ \
	--exclude npins/ \
	--exclude package-lock.json \
	--exec sed -i -E 's/\s$//g; :A; s/^(\t*)(  )/\1\t/; tA'

tsgo