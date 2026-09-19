# Supported and unsupported analysis

## Languages

| Language | Adapter | Extracted |
|---|---|---|
| TypeScript / TSX / JavaScript | tree-sitter | ES imports + `require`, classes (decorators, fields, constructor-parameter injection, `this.x = …`), interfaces, enums, functions/arrow functions, calls (receiver normalised), `new` type refs, Express/Fastify/Koa route registrations, NestJS `@Controller/@Get/…`, TypeORM entities |
| Python | tree-sitter | imports (relative + package resolution), classes (bases, decorators, class-level assignments), `__init__` typed params and `self.x` assignments, functions, calls, FastAPI/Flask/Django route decorators, SQLAlchemy and Django models |
| Java | tree-sitter | package/imports, classes/interfaces/enums/records, annotations (Spring MVC, `@Service`, JPA/Jakarta), field and constructor injection, calls, `new` type refs, Spring Data `JpaRepository<Entity, Id>` |
| Go | tree-sitter | package/imports, structs (fields as dependencies, embedded structs), interfaces, functions, methods with receivers, calls, net/http · gin · chi · echo style route registrations, GORM structs |
| SQL DDL (`.sql`, `.ddl`) | built-in | `CREATE TABLE` columns, PK/FK/UNIQUE/NOT NULL, inline `REFERENCES`, `ALTER TABLE … ADD FOREIGN KEY`; PostgreSQL/MySQL/SQLite/SQL Server quoting and schema prefixes |
| Prisma (`.prisma`) | built-in | models, `@id`, `@unique`, `@relation(fields:…)`, `@@map`, enums, implicit many-to-many |
| Rust, Ruby, PHP, C#, Kotlin, Swift, Scala, C/C++, Dart, Elixir, … | fallback | files are indexed (change detection, `status`) but **no structural facts are extracted** and nothing is guessed |

## What is deterministic vs inferred

Deterministic (from code): imports, class/function structure, framework annotations, route
registrations, typed injection, calls through typed fields/params/imports, schema definitions, `Repository<X>`
data access, external package calls.

Inferred (heuristics, marked `?`): roles from naming conventions (`*Service`), calls through untyped fields
matched by name (`orderService` → `OrderService`), unique-name matches across files, data-client member names
(`prisma.user`), derived use case names.

Unknown (marked `??`, asked as a question): actors, business names for non-descriptive operations
(`handle`, `run`, `index`), roles of unannotated classes that take part in interactions, entities referenced
but not defined.

## Known limitations

* Dynamic dispatch, dependency-injection containers configured at runtime, event buses and reflection are not
  followed. Declare missing links with `overrides.relationships`.
* Calls on the result of another call (`repo.find(id).then(…)`, `Optional.orElse`) are not attributed — the
  receiver type is unknown.
* Local variables are not typed (`const svc = new X(); svc.run()` is not resolved; `new X()` still creates a
  `uses` dependency).
* Route prefixes are combined from class + method annotations; globally mounted prefixes (`app.use('/api',
  router)`) are not.
* Branches/loops are not rendered as `alt`/`loop` fragments yet (the IR supports them).
* Multi-file Go packages: methods on structs defined in another file of the same package are attached; other
  cross-file resolution relies on unique names.
