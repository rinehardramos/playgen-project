SERVICES := auth station library scheduler playlist analytics dj

.PHONY: build-all $(SERVICES) gateway migrate frontend up down clean

build-all: $(SERVICES) gateway migrate frontend
	@echo "All images built."

$(SERVICES):
	docker build -t playgen-$@ -f services/$@/Dockerfile .

gateway:
	docker build -t playgen-gateway -f gateway/Dockerfile .

migrate:
	docker build -t playgen-migrate -f shared/db/Dockerfile .

frontend:
	docker build -t playgen-frontend -f frontend/Dockerfile frontend/

up: build-all
	docker compose up -d

down:
	docker compose down

clean:
	docker compose down -v --rmi local
