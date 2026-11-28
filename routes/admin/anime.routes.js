const express = require("express");

// CONTROLLERS
const controllers = {
  anime: require("../../controllers/admin/anime.controllers"),
};

// MIDDLEWARES
const middlewares = {
  anime: require("../../middlewares/admin/anime.middlewares"),
};

const router = express.Router();

router.get("/",
  controllers.anime.list,
);

router.post("/sync/:malId",
  controllers.anime.sync,
);

router.get("/:id",
  middlewares.anime.anime,
  controllers.anime.show,
);

router.patch("/:id",
  middlewares.anime.anime,
  controllers.anime.update,
);

router.get("/:id/episodes",
  middlewares.anime.anime,
  controllers.anime.episodes,
);

router.post("/:id/episodes",
  middlewares.anime.anime,
  controllers.anime.createEpisode,
);

router.post("/:id/episodes/sync",
  middlewares.anime.anime,
  controllers.anime.syncEpisodes,
);

router.patch("/episodes/:id",
  middlewares.anime.episode,
  controllers.anime.episode,
);

router.post("/:id/segments/fetch",
  middlewares.anime.anime,
  controllers.anime.fetchAnimeSegments,
);

router.post("/episodes/:id/segments/fetch",
  middlewares.anime.episode,
  controllers.anime.fetchSegments,
);

router.put("/episodes/:id/segments/:type",
  middlewares.anime.episode,
  middlewares.anime.segment,
  controllers.anime.setSegment,
);

router.delete("/episodes/:id/segments/:type",
  middlewares.anime.episode,
  middlewares.anime.segment,
  controllers.anime.removeSegment,
);

router.post("/episodes/:id/sources",
  middlewares.anime.episode,
  middlewares.anime.source,
  controllers.anime.source,
);

router.post("/episodes/:id/subtitles",
  middlewares.anime.episode,
  middlewares.anime.subtitle,
  controllers.anime.subtitle,
);

// El cuerpo es el archivo tal cual (hasta 5 MB: un .ass con karaoke puede pasar de 1 MB).
router.post("/episodes/:id/subtitles/upload",
  middlewares.anime.episode,
  express.raw({ type: "application/octet-stream", limit: "5mb" }),
  middlewares.anime.subtitleFile,
  controllers.anime.uploadSubtitle,
);

router.patch("/subtitles/:id",
  controllers.anime.updateSubtitle,
);

router.delete("/subtitles/:id",
  controllers.anime.removeSubtitle,
);

router.post("/episodes/:id/uploads",
  middlewares.anime.episode,
  middlewares.anime.uploadRequest,
  controllers.anime.createUpload,
);

router.post("/episodes/:id/audio-uploads",
  middlewares.anime.episode,
  middlewares.anime.audioRequest,
  controllers.anime.createAudioUpload,
);

router.get("/episodes/:id/audio",
  middlewares.anime.episode,
  controllers.anime.listAudio,
);

router.put("/episodes/:id/audio/:dir/default",
  middlewares.anime.episode,
  controllers.anime.defaultAudio,
);

router.patch("/episodes/:id/audio/:dir",
  middlewares.anime.episode,
  controllers.anime.renameAudio,
);

router.delete("/episodes/:id/audio/:dir",
  middlewares.anime.episode,
  controllers.anime.removeAudio,
);

router.post("/uploads/:id/complete",
  middlewares.anime.upload,
  controllers.anime.completeUpload,
);

router.post("/uploads/:id/retry",
  middlewares.anime.upload,
  controllers.anime.retryUpload,
);

router.delete("/uploads/:id",
  middlewares.anime.upload,
  controllers.anime.removeUpload,
);

router.delete("/sources/:id",
  controllers.anime.removeSource,
);

module.exports = router;
