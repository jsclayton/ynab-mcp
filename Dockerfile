FROM denoland/deno:alpine AS deps

WORKDIR /app
COPY deno.json deno.lock .
RUN deno install --frozen

FROM denoland/deno:alpine

WORKDIR /app
COPY --from=deps /deno-dir/ /deno-dir/
COPY deno.json deno.lock .
COPY src/ src/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "src/http.ts"]
