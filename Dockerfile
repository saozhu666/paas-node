# Build sing-box from source with a patched grpc (CVE-2026-33186:
# sing-box v1.14.4 bundles grpc v1.79.1; some platform security scans
# reject the image until grpc >= v1.79.3).
FROM golang:1.25-alpine AS build
RUN apk add --no-cache git ca-certificates
WORKDIR /src
RUN git clone --depth 1 --branch v1.14.4 https://github.com/SagerNet/sing-box.git .
RUN go mod edit -replace=google.golang.org/grpc@v1.79.1=google.golang.org/grpc@v1.79.3
RUN go mod tidy
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/sing-box ./cmd/sing-box

FROM alpine:3.24
RUN apk add --no-cache ca-certificates
COPY --from=build /out/sing-box /usr/local/bin/sing-box
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
