build/bot.js: web tsconfig.json $(shell python -c "import json; print(' '.join(json.loads(' '.join(filter(lambda x: '//' not in x, open('tsconfig.json'))))['files']))")
	node node_modules/opal-transformer/build/main.js tsconfig.json

web: web/chat.ts
	tsc -p web
	cp -R web build/

.PHONY: build
build:
	yarn
	yarn run build
	yarn run build-web

# Run the bot with environment variables from `.env` and arguments from $ARGS.
.PHONY: run
run: build/bot.js
	export $$(cat .env | xargs) && \
		node build/bot.js $(ARGS)

.PHONY: deploy update
deploy:
	ssh waffle 'cd waffle; docker-compose exec -T opal make update; \
		docker-compose restart opal'
update:
	git pull
	make
