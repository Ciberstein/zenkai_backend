# Zenkai — Backend

API REST de la plataforma de streaming de anime. Node + Express + Sequelize
(PostgreSQL), con Redis como cache de la API publica de
[Jikan](https://docs.api.jikan.moe) (MyAnimeList).

## Arranque

```bash
npm install
cp .env.example .env   # completar credenciales
npm start              # nodemon server.js
```

## Estructura

```
app.js            Express, CORS, helmet, rate limit y montaje de /api/v1
server.js         Boot: auth DB, schemas, sync, migraciones y seeders
cors/             Politica de origenes permitidos (deriva de FRONTEND_DOMAIN)
database/         Conexion, creacion de schemas y migraciones idempotentes
models/           Modelos Sequelize por dominio + init.models.js (relaciones)
seeders/          Datos base (roles, config, idiomas, generos) + data/
routes/           Routers por grupo: auth, public, user (/me), admin
middlewares/      Validacion y carga de recursos, mismo arbol que routes/
controllers/      Respuestas HTTP, mismo arbol que routes/
services/         Integraciones: jikan, catalog (espejo), redis, auth, logger
scheduler/        Cron: refresco diario y continuacion del backfill
scripts/          Tareas de una sola vez (backfill del catalogo)
utils/            Helpers puros (appError, catchAsync, jwt, hash, paginacion)
```

El flujo de una peticion es siempre el mismo:
`routes -> middlewares (valida y carga en req) -> controllers (responde)`.

## Grupos de rutas

| Prefijo             | Acceso                    | Contenido                                    |
| ------------------- | ------------------------- | -------------------------------------------- |
| `/api/v1/auth`      | publico                   | register, login, logout, refresh, validate   |
| `/api/v1/public`    | publico                   | catalogo, fichas, episodios, config, idiomas |
| `/api/v1/me`        | sesion requerida          | cuenta, perfil, watchlist, favoritos, historial |
| `/api/v1/admin`     | authority >= 30000        | cuentas, catalogo, episodios, fuentes, logs  |

## Espejo local del catalogo

El catalogo publico **no consulta Jikan**: se sirve desde Postgres. Jikan solo
alimenta el espejo.

```bash
npm run sync:catalog             # backfill completo (~30.400 titulos, ~25 min)
npm run sync:catalog -- 50       # solo 50 paginas (1.250 titulos)
npm run sync:catalog -- 50 top   # forzando la fuente alternativa
```

**Una sola fuente: la API oficial de MyAnimeList**
(`api.myanimelist.net/v2/anime/ranking`). 500 entradas por peticion, el catalogo
entero en ~2,5 min. El Client ID se saca registrando una app en
[myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) (gratis) y se pega
en `MAL_CLIENT_ID`.

Hubo dos fuentes de Jikan como respaldo y se retiraron: cuando Jikan falla es
porque no alcanza a MyAnimeList, o sea que si la oficial esta caida el respaldo
tambien lo esta. Jikan se quedo solo para lo que la oficial no expone.

La oficial devuelve `tv`/`finished_airing`/`friday` donde Jikan daba
`TV`/`Finished Airing`/`Fridays`; el mapper lo normaliza al escribir para que los
filtros y el calendario sigan valiendo. Todo se guarda por `mal_id` con upsert,
asi que resincronizar nunca duplica.

### Reparto de fuentes

| Dato | Fuente | Por que |
| --- | --- | --- |
| Catalogo, fichas, metricas, temporadas | MAL oficial | Autoritativa y rapida |
| Recomendaciones y relacionados | MAL oficial | Vienen en la propia ficha |
| **Listas de episodios** | **Jikan** | `/anime/{id}/episodes` responde 403 en la oficial |
| Personajes | Jikan | La oficial ignora el campo `characters` |
| Enlaces de video | ninguna | No existen en ninguna API; se cargan a mano |

**Una pagina caida no tumba el trabajo**: se anota en `failedPages`, se sigue
con la siguiente y al final se repescan. Solo se aborta tras 15 fallos seguidos,
que ya no es intermitencia sino que MyAnimeList esta caido del todo.

Es **reanudable**: el cursor vive en `anime.anime_sync_state`, asi que se puede
cortar con Ctrl+C, o caerse Jikan a mitad, y la siguiente ejecucion sigue por
donde iba, repescando ademas las paginas que quedaron pendientes. Volver a sincronizar un titulo no
duplica nada ni pisa lo que gestiona el panel (`featured`, `visible`, banner).

### Episodios

```bash
npm run sync:episodes           # 100 titulos, por orden de popularidad
npm run sync:episodes -- 500    # 500 titulos
```

Trae las **listas** de episodios (numero, titulo, fecha, filler) de los titulos
ya replicados, empezando por los mas populares: con MAL cayendose a ratos,
conviene gastar las peticiones que funcionan en lo que el usuario ve primero.
Cada titulo queda marcado en `episodesSyncedAt` y no se vuelve a pedir.

Los **enlaces de video** no salen de aqui: Jikan no los tiene. Se cargan desde
el panel (`anime_sources`), uno por servidor/idioma/calidad.

Despues el cron lo mantiene al dia (horario en UTC):

| Trabajo | Cuando | Que hace |
| --- | --- | --- |
| `catalog:refresh` | todos los dias, 05:00 | Score, miembros y episodios de lo que esta en emision, de los proximos estrenos y de lo mas popular |
| `catalog:airing-episodes` | cada 6 horas | Capitulos nuevos de las series en emision: 80 por tanda, las que mas tiempo llevan sin revisarse, y solo desde la ultima pagina de episodios conocida |
| `catalog:full-sync` | domingos, 03:00 | Barrido completo del catalogo (~30.000 titulos, menos de un minuto con la API oficial). No pisa `featured`, `visible` ni el banner |
| `catalog:backfill` | cada hora | Continua el barrido si quedo a medias; no hace nada si esta completo |
| `catalog:episodes` | cada hora (:30) | Listas de episodios de 40 titulos populares que aun no las tienen; no hace nada si no queda ninguno |

Cada ejecucion se registra en `anime.anime_sync_state` (fila `job:<nombre>`: estado,
inicio, fin, resultado) y se puede ver y lanzar a mano desde **Admin → Tareas**
(`GET /api/v1/admin/jobs`, `POST /api/v1/admin/jobs/:name/run`, esta ultima solo
authority >= 40000). Con varias instancias de la API, cada trabajo toma un bloqueo en
Redis (`lock:<nombre>`) para que no corra dos veces; `full-sync` y `backfill` comparten
el suyo porque recorren el mismo cursor. Si Redis no responde, se cae al control en
memoria del proceso en vez de dejar de ejecutar.

Ademas, una ficha que se visita y lleva mas de 14 dias sin refrescar se
revalida sola contra Jikan; si falla, se sirve igual desde base.

Lo que **no** se replica: personajes y recomendaciones (colas largas que no
justifican el espacio) y los episodios, que se traen bajo demanda desde el panel
solo para los titulos que se emiten. Las imagenes son enlaces al CDN de MAL.

## Notas de diseno

- **Jikan solo aporta metadata.** No entrega video: los enlaces reproducibles
  viven en `anime.anime_sources`, uno por servidor/idioma/calidad. Estar en el
  catalogo no implica poder verlo: el flag `available` distingue las ~29.000
  fichas de MAL de lo que de verdad tiene episodios con fuentes.
- **Cola hacia Jikan compartida entre procesos** (`services/modules/jikan.service.js`).
  Respeta los dos techos de su API: 400 ms entre llamadas (3 req/s) **y** ventana
  deslizante de 50 por minuto (el limite real es 60). El permiso se pide a Redis
  con un script Lua, porque el limite es **por IP**: la API y los scripts de
  sincronizacion comparten cuota y un limitador en memoria haria que cada proceso
  se creyera solo. Si Redis no responde, se cae al limitador local. Un 429 abre un
  cooldown de 60 s que tambien se comparte, en vez de insistir. La cache guarda 7 dias y sirve la copia vieja si el upstream
  falla, asi que una caida de MyAnimeList no se nota.
- **Autenticacion por cookies httpOnly** (`zk_access` / `zk_refresh`) con
  rotacion del refresh en cada uso y revocacion por sesion en base de datos.
- **`authority` numerica** en vez de rol string: los permisos son una sola
  comparacion (`>= 30000` staff, `>= 40000` admin).
