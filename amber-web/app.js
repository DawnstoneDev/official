class AmberPlayer {

  constructor() {
    this.db = null;

    this.audio = new Audio();
    this.audio.preload = "metadata";

    this.audioContext = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.analyserNode = null;
    this.eqFilters = [];

    this.library = [];
    this.playlists = [];

    this.queue = [];
    this.queueIndex = -1;

    this.currentTrack = null;
    this.currentView = "home";

    this.shuffle = false;
    this.repeat = "off";

    this.searchQuery = "";
    this.selectedArtist = null;
    this.selectedAlbum = null;
    this.selectedPlaylist = null;

    this.likedTracks = new Set();

    this.presets = {
      flat: [0,0,0,0,0,0,0,0,0],
      bass: [6,5,4,2,0,0,0,0,0],
      vocal: [-2,-1,1,3,4,4,3,1,0],
      rock: [5,3,1,-1,-1,0,2,4,5],
      pop: [-1,2,4,5,3,0,1,2,2],
      classical: [4,3,2,2,-1,-1,0,2,3]
    };

    this.init();
  }

  async init() {
    await this.initDB();

    this.loadPreferences();

    this.setupAudio();
    this.setupEvents();

    await this.loadLibrary();
    await this.loadPlaylists();

    this.renderPlaylists();
    this.renderMobilePlaylists();

    this.renderView("home");

    this.startVisualizer();

    this.updatePlayer();
  }

  initDB() {
    return new Promise((resolve, reject) => {

      const request = indexedDB.open("AmberMusicDB_v3", 1);

      request.onupgradeneeded = event => {

        const db = event.target.result;

        if (!db.objectStoreNames.contains("tracks")) {
          db.createObjectStore("tracks", {
            keyPath: "id"
          });
        }

        if (!db.objectStoreNames.contains("playlists")) {
          db.createObjectStore("playlists", {
            keyPath: "id"
          });
        }
      };

      request.onsuccess = event => {
        this.db = event.target.result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  dbPut(store, value) {
    return new Promise(resolve => {

      const tx = this.db.transaction(store, "readwrite");

      tx.objectStore(store).put(value);

      tx.oncomplete = resolve;
    });
  }

  dbDelete(store, id) {
    return new Promise(resolve => {

      const tx = this.db.transaction(store, "readwrite");

      tx.objectStore(store).delete(id);

      tx.oncomplete = resolve;
    });
  }

  dbGetAll(store) {
    return new Promise(resolve => {

      const tx = this.db.transaction(store, "readonly");

      const request = tx.objectStore(store).getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => resolve([]);
    });
  }

  async loadLibrary() {
    this.library = await this.dbGetAll("tracks");
  }

  async loadPlaylists() {
    this.playlists = await this.dbGetAll("playlists");
  }

  loadPreferences() {

    try {
      const liked = JSON.parse(
        localStorage.getItem("amber-liked") || "[]"
      );

      this.likedTracks = new Set(liked);

    } catch {
      this.likedTracks = new Set();
    }
  }

  savePreferences() {
    localStorage.setItem(
      "amber-liked",
      JSON.stringify([...this.likedTracks])
    );
  }

  setupAudio() {

    const AudioContext =
      window.AudioContext ||
      window.webkitAudioContext;

    this.audioContext = new AudioContext();

    this.sourceNode =
      this.audioContext.createMediaElementSource(this.audio);

    this.gainNode =
      this.audioContext.createGain();

    this.analyserNode =
      this.audioContext.createAnalyser();

    this.analyserNode.fftSize = 128;

    const frequencies = [
      60,
      120,
      250,
      500,
      1000,
      2000,
      4000,
      8000,
      16000
    ];

    let previous = this.sourceNode;

    frequencies.forEach((frequency, index) => {

      const filter =
        this.audioContext.createBiquadFilter();

      if (index === 0) {
        filter.type = "lowshelf";
      } else if (index === frequencies.length - 1) {
        filter.type = "highshelf";
      } else {
        filter.type = "peaking";
      }

      filter.frequency.value = frequency;
      filter.Q.value = 1;
      filter.gain.value = 0;

      previous.connect(filter);

      previous = filter;

      this.eqFilters.push(filter);
    });

    previous.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.audioContext.destination);

    this.audio.addEventListener("timeupdate", () => {
      this.updateProgress();
    });

    this.audio.addEventListener("loadedmetadata", () => {
      this.updateProgress();
    });

    this.audio.addEventListener("ended", () => {
      this.nextTrack(true);
    });
  }

  setupEvents() {

    document.querySelectorAll(".nav-item").forEach(button => {

      button.addEventListener("click", () => {

        this.setActiveNavigation(button.dataset.view);

        this.renderView(button.dataset.view);
      });
    });

    document.querySelectorAll(".mobile-nav-item[data-view]").forEach(button => {

      button.addEventListener("click", () => {

        this.setActiveNavigation(button.dataset.view);

        this.renderView(button.dataset.view);
      });
    });

    document
      .getElementById("add-music")
      .addEventListener("click", () => {
        document.getElementById("file-input").click();
      });

    document
      .getElementById("file-input")
      .addEventListener("change", event => {
        this.handleFiles(event.target.files);
        event.target.value = "";
      });

    document
      .getElementById("create-playlist")
      .addEventListener("click", () => {
        this.createPlaylist();
      });

    document
      .getElementById("mobile-create-playlist")
      .addEventListener("click", () => {
        this.createPlaylist();
      });

    document
      .getElementById("mobile-add-music")
      .addEventListener("click", () => {
        document.getElementById("file-input").click();
        this.closeLibrarySheet();
      });

    document
      .getElementById("mobile-library")
      .addEventListener("click", () => {
        this.openLibrarySheet();
      });

    document
      .getElementById("close-library-sheet")
      .addEventListener("click", () => {
        this.closeLibrarySheet();
      });

    document
      .getElementById("search")
      .addEventListener("input", event => {

        this.searchQuery =
          event.target.value.trim().toLowerCase();

        document
          .getElementById("clear-search")
          .classList.toggle(
            "hidden",
            !this.searchQuery
          );

        this.renderView(
          this.searchQuery ? "search" : this.currentView
        );
      });

    document
      .getElementById("clear-search")
      .addEventListener("click", () => {

        document.getElementById("search").value = "";

        this.searchQuery = "";

        document
          .getElementById("clear-search")
          .classList.add("hidden");

        this.renderView(this.currentView);
      });

    document
      .getElementById("play")
      .addEventListener("click", () => {
        this.togglePlay();
      });

    document
      .getElementById("mobile-player-play")
      .addEventListener("click", event => {
        event.stopPropagation();
        this.togglePlay();
      });

    document
      .getElementById("mobile-play")
      .addEventListener("click", () => {
        this.togglePlay();
      });

    document
      .getElementById("previous")
      .addEventListener("click", () => {
        this.previousTrack();
      });

    document
      .getElementById("mobile-previous")
      .addEventListener("click", () => {
        this.previousTrack();
      });

    document
      .getElementById("next")
      .addEventListener("click", () => {
        this.nextTrack(false);
      });

    document
      .getElementById("mobile-next")
      .addEventListener("click", () => {
        this.nextTrack(false);
      });

    document
      .getElementById("shuffle")
      .addEventListener("click", () => {
        this.shuffle = !this.shuffle;
        this.updatePlaybackButtons();
      });

    document
      .getElementById("mobile-shuffle")
      .addEventListener("click", () => {
        this.shuffle = !this.shuffle;
        this.updatePlaybackButtons();
      });

    document
      .getElementById("repeat")
      .addEventListener("click", () => {
        this.cycleRepeat();
      });

    document
      .getElementById("mobile-repeat")
      .addEventListener("click", () => {
        this.cycleRepeat();
      });

    document
      .getElementById("progress")
      .addEventListener("click", event => {
        this.seek(event, "progress");
      });

    document
      .getElementById("now-playing-progress")
      .addEventListener("click", event => {
        this.seek(event, "now-playing-progress");
      });

    document
      .getElementById("volume")
      .addEventListener("input", event => {
        this.setVolume(event.target.value);
      });

    document
      .getElementById("mobile-volume")
      .addEventListener("input", event => {
        this.setVolume(event.target.value);
      });

    document
      .getElementById("open-queue")
      .addEventListener("click", () => {
        document
          .getElementById("queue-panel")
          .classList.remove("hidden");
      });

    document
      .getElementById("close-queue")
      .addEventListener("click", () => {
        document
          .getElementById("queue-panel")
          .classList.add("hidden");
      });

    document
      .getElementById("clear-queue")
      .addEventListener("click", () => {
        this.queue = [];
        this.queueIndex = -1;
        this.renderQueue();
      });

    document
      .getElementById("player-like")
      .addEventListener("click", () => {
        this.toggleLike();
      });

    document
      .getElementById("player-artist")
      .addEventListener("click", () => {
        if (this.currentTrack) {
          this.openArtist(this.currentTrack.artist);
        }
      });

    document
      .getElementById("now-playing-artist")
      .addEventListener("click", () => {
        if (this.currentTrack) {
          this.closeNowPlaying();
          this.openArtist(this.currentTrack.artist);
        }
      });

    document
      .getElementById("mobile-player")
      .addEventListener("click", () => {
        this.openNowPlaying();
      });

    document
      .getElementById("close-now-playing")
      .addEventListener("click", () => {
        this.closeNowPlaying();
      });

    document
      .getElementById("open-eq")
      .addEventListener("click", () => {
        this.openEqualizer();
      });

    document
      .getElementById("open-settings")
      .addEventListener("click", () => {
        this.openSettings();
      });

    window.addEventListener("dragover", event => {
      event.preventDefault();

      document
        .getElementById("drop-overlay")
        .classList.remove("hidden");
    });

    window.addEventListener("dragleave", event => {

      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        document
          .getElementById("drop-overlay")
          .classList.add("hidden");
      }
    });

    window.addEventListener("drop", event => {

      event.preventDefault();

      document
        .getElementById("drop-overlay")
        .classList.add("hidden");

      this.handleFiles(event.dataTransfer.files);
    });

    document.addEventListener("click", event => {

      const menu =
        document.getElementById("context-menu");

      if (
        !menu.contains(event.target) &&
        !event.target.closest(".row-menu")
      ) {
        menu.classList.add("hidden");
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 700) {
        this.closeLibrarySheet();
      }
    });
  }

  async handleFiles(files) {

    if (!files || !files.length) {
      return;
    }

    for (const file of files) {

      if (!file.type.startsWith("audio/")) {
        continue;
      }

      const metadata =
        await this.parseMetadata(file);

      const track = {
        id: crypto.randomUUID(),
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        picture: metadata.picture || null,
        file,
        dateAdded: Date.now()
      };

      await this.dbPut("tracks", track);

      this.library.push(track);
    }

    this.renderPlaylists();
    this.renderMobilePlaylists();
    this.renderView(this.currentView);
  }

  parseMetadata(file) {

    return new Promise(resolve => {

      const fallback = {
        title: file.name.replace(/\.[^/.]+$/, ""),
        artist: "Unknown Artist",
        album: "Unknown Album",
        picture: null
      };

      if (!window.jsmediatags) {
        resolve(fallback);
        return;
      }

      window.jsmediatags.read(file, {

        onSuccess: tag => {

          const tags = tag.tags || {};

          let picture = null;

          if (tags.picture && tags.picture.data) {

            const data = tags.picture.data;
            const format =
              tags.picture.format || "image/jpeg";

            let binary = "";

            for (let i = 0; i < data.length; i++) {
              binary += String.fromCharCode(data[i]);
            }

            picture =
              `data:${format};base64,${btoa(binary)}`;
          }

          resolve({
            title:
              tags.title ||
              fallback.title,

            artist:
              tags.artist ||
              tags.albumartist ||
              fallback.artist,

            album:
              tags.album ||
              fallback.album,

            picture
          });
        },

        onError: () => {
          resolve(fallback);
        }
      });
    });
  }

  async playTrack(track, queue = null, index = 0) {

    if (!track) {
      return;
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    if (queue) {
      this.queue = [...queue];
      this.queueIndex = index;
    }

    this.currentTrack = track;

    if (track.file) {

      if (this.audio._amberURL) {
        URL.revokeObjectURL(this.audio._amberURL);
      }

      this.audio._amberURL =
        URL.createObjectURL(track.file);

      this.audio.src =
        this.audio._amberURL;

      await this.audio.play();

      this.updatePlayer();

      this.renderQueue();

      this.renderView(this.currentView);
    }
  }

  togglePlay() {

    if (!this.currentTrack) {
      const tracks = this.getSearchResults();

      if (tracks.length) {
        this.playTrack(tracks[0], tracks, 0);
      }

      return;
    }

    if (this.audio.paused) {

      if (this.audioContext.state === "suspended") {
        this.audioContext.resume();
      }

      this.audio.play();

    } else {

      this.audio.pause();
    }

    this.updatePlayer();
  }

  previousTrack() {

    if (!this.queue.length) {
      return;
    }

    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }

    let nextIndex =
      this.queueIndex - 1;

    if (nextIndex < 0) {
      nextIndex =
        this.repeat === "all"
          ? this.queue.length - 1
          : 0;
    }

    this.queueIndex = nextIndex;

    this.playTrack(
      this.queue[this.queueIndex]
    );
  }

  nextTrack(fromEnded = false) {

    if (!this.queue.length) {
      return;
    }

    if (
      fromEnded &&
      this.repeat === "one"
    ) {
      this.audio.currentTime = 0;
      this.audio.play();
      return;
    }

    let nextIndex;

    if (this.shuffle) {

      const candidates =
        this.queue
          .map((track,index) => index)
          .filter(index => index !== this.queueIndex);

      if (!candidates.length) {
        nextIndex = this.queueIndex;
      } else {
        nextIndex =
          candidates[
            Math.floor(
              Math.random() *
              candidates.length
            )
          ];
      }

    } else {

      nextIndex =
        this.queueIndex + 1;
    }

    if (nextIndex >= this.queue.length) {

      if (this.repeat === "all") {
        nextIndex = 0;
      } else {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.updatePlayer();
        return;
      }
    }

    this.queueIndex = nextIndex;

    this.playTrack(
      this.queue[this.queueIndex]
    );
  }

  cycleRepeat() {

    if (this.repeat === "off") {
      this.repeat = "all";
    } else if (this.repeat === "all") {
      this.repeat = "one";
    } else {
      this.repeat = "off";
    }

    this.updatePlaybackButtons();
  }

  setVolume(value) {

    const volume =
      Math.max(
        0,
        Math.min(1, Number(value))
      );

    this.gainNode.gain.value = volume;

    document.getElementById("volume").value =
      volume;

    document.getElementById("mobile-volume").value =
      volume;
  }

  seek(event, id) {

    const element =
      document.getElementById(id);

    const rect =
      element.getBoundingClientRect();

    const ratio =
      (event.clientX - rect.left) /
      rect.width;

    if (this.audio.duration) {
      this.audio.currentTime =
        Math.max(
          0,
          Math.min(1, ratio)
        ) *
        this.audio.duration;
    }
  }

  getSearchResults() {

    if (!this.searchQuery) {
      return [...this.library];
    }

    const q = this.searchQuery;

    return this.library.filter(track => {

      return [
        track.title,
        track.artist,
        track.album
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }

  getArtistTracks(artist) {

    return this.library.filter(track => {

      return track.artist
        .trim()
        .toLowerCase() ===
        artist.trim().toLowerCase();
    });
  }

  getAlbumTracks(album, artist = null) {

    return this.library.filter(track => {

      const sameAlbum =
        track.album
          .trim()
          .toLowerCase() ===
        album.trim().toLowerCase();

      if (!artist) {
        return sameAlbum;
      }

      return sameAlbum &&
        track.artist
          .trim()
          .toLowerCase() ===
        artist.trim().toLowerCase();
    });
  }

  getPlaylistTracks(playlist) {

    if (!playlist) {
      return [];
    }

    return playlist.trackIds
      .map(id =>
        this.library.find(
          track => track.id === id
        )
      )
      .filter(Boolean);
  }

  getArtists() {

    const map = new Map();

    this.library.forEach(track => {

      const name =
        track.artist || "Unknown Artist";

      if (!map.has(name)) {
        map.set(name, {
          name,
          tracks: [],
          picture: null
        });
      }

      const artist =
        map.get(name);

      artist.tracks.push(track);

      if (!artist.picture && track.picture) {
        artist.picture = track.picture;
      }
    });

    return [...map.values()]
      .sort((a,b) =>
        a.name.localeCompare(
          b.name,
          undefined,
          { sensitivity: "base" }
        )
      );
  }

  getAlbums() {

    const map = new Map();

    this.library.forEach(track => {

      const key =
        `${track.album}|||${track.artist}`;

      if (!map.has(key)) {
        map.set(key, {
          name: track.album,
          artist: track.artist,
          picture: track.picture,
          tracks: []
        });
      }

      map.get(key).tracks.push(track);
    });

    return [...map.values()]
      .sort((a,b) =>
        a.name.localeCompare(b.name)
      );
  }

  setActiveNavigation(view) {

    document
      .querySelectorAll(".nav-item")
      .forEach(item => {
        item.classList.toggle(
          "active",
          item.dataset.view === view
        );
      });

    document
      .querySelectorAll(".mobile-nav-item[data-view]")
      .forEach(item => {
        item.classList.toggle(
          "active",
          item.dataset.view === view
        );
      });
  }

  renderView(view) {

    if (
      view !== "artist" &&
      view !== "album" &&
      view !== "playlist"
    ) {
      this.currentView = view;
    }

    const container =
      document.getElementById("content");

    if (!this.library.length) {

      container.innerHTML =
        this.emptyLibrary();

      return;
    }

    switch (view) {

      case "home":
        container.innerHTML =
          this.renderHome();
        this.bindTrackRows(container);
        break;

      case "songs":
        container.innerHTML =
          this.renderSongs(
            this.library,
            "All Songs"
          );
        this.bindTrackRows(container);
        break;

      case "artists":
        container.innerHTML =
          this.renderArtists();
        this.bindArtistCards(container);
        break;

      case "albums":
        container.innerHTML =
          this.renderAlbums();
        this.bindAlbumCards(container);
        break;

      case "artist":
        container.innerHTML =
          this.renderArtistPage(
            this.selectedArtist
          );
        this.bindTrackRows(container);
        break;

      case "album":
        container.innerHTML =
          this.renderAlbumPage(
            this.selectedAlbum
          );
        this.bindTrackRows(container);
        break;

      case "playlist":
        container.innerHTML =
          this.renderPlaylistPage(
            this.selectedPlaylist
          );
        this.bindTrackRows(container);
        this.bindPlaylistActions(container);
        break;

      case "search":
        container.innerHTML =
          this.renderSearch();
        this.bindTrackRows(container);
        this.bindArtistCards(container);
        this.bindAlbumCards(container);
        break;

      default:
        container.innerHTML =
          this.renderHome();
        this.bindTrackRows(container);
    }
  }

  renderHome() {

    const recent =
      [...this.library]
        .sort((a,b) =>
          (b.dateAdded || 0) -
          (a.dateAdded || 0)
        )
        .slice(0,8);

    const artists =
      this.getArtists().slice(0,6);

    const albums =
      this.getAlbums().slice(0,6);

    return `

      <div class="hero">
        <span class="hero-kicker">DAWNSTONE / AMBER</span>
        <h1>Music,<br>quietly.</h1>
        <p>
          Your music library, beautifully organized.
          Local playback. Native feeling.
        </p>
      </div>

      <div class="section">
        <h2 class="section-title">Recently Added</h2>
        ${this.renderTrackTable(recent)}
      </div>

      ${
        artists.length
          ? `
            <div class="section">
              <h2 class="section-title">Artists</h2>

              <div class="artist-grid">
                ${artists.map(
                  artist => this.artistCard(artist)
                ).join("")}
              </div>
            </div>
          `
          : ""
      }

      ${
        albums.length
          ? `
            <div class="section">
              <h2 class="section-title">Albums</h2>

              <div class="album-grid">
                ${albums.map(
                  album => this.albumCard(album)
                ).join("")}
              </div>
            </div>
          `
          : ""
      }
    `;
  }

  renderSongs(tracks, title) {

    return `
      <div class="page-header">
        <div>
          <div class="page-kicker">LIBRARY</div>
          <h1 class="page-title">${this.escape(title)}</h1>
          <p class="page-description">
            ${tracks.length} ${tracks.length === 1 ? "song" : "songs"}
          </p>
        </div>

        <div class="header-actions">
          <button
            class="primary-button"
            data-play-all="true"
          >
            ▶ Play
          </button>
        </div>
      </div>

      ${this.renderTrackTable(tracks)}
    `;
  }

  renderArtists() {

    const artists =
      this.getArtists();

    return `
      <div class="page-header">
        <div>
          <div class="page-kicker">LIBRARY</div>
          <h1 class="page-title">Artists</h1>
          <p class="page-description">
            ${artists.length} artists in your library.
          </p>
        </div>
      </div>

      <div class="artist-grid">
        ${artists.map(
          artist => this.artistCard(artist)
        ).join("")}
      </div>
    `;
  }

  renderAlbums() {

    const albums =
      this.getAlbums();

    return `
      <div class="page-header">
        <div>
          <div class="page-kicker">LIBRARY</div>
          <h1 class="page-title">Albums</h1>
          <p class="page-description">
            ${albums.length} albums in your library.
          </p>
        </div>
      </div>

      <div class="album-grid">
        ${albums.map(
          album => this.albumCard(album)
        ).join("")}
      </div>
    `;
  }

  renderArtistPage(name) {

    const tracks =
      this.getArtistTracks(name);

    const artist =
      this.getArtists()
        .find(item =>
          item.name.toLowerCase() ===
          name.toLowerCase()
        );

    return `

      <div class="artist-hero">

        <div
          class="detail-art"
          ${artist && artist.picture
            ? `style="background-image:url('${artist.picture}')"`
            : ""}
        >
          ${
            artist && artist.picture
              ? ""
              : "◎"
          }
        </div>

        <div>
          <div class="detail-type">ARTIST</div>

          <h1 class="detail-title">
            ${this.escape(name)}
          </h1>

          <div class="detail-meta">
            ${tracks.length}
            ${tracks.length === 1 ? "song" : "songs"}
          </div>

          <div class="detail-actions">
            <button
              class="play-circle"
              data-play-artist="true"
            >
              ▶
            </button>
          </div>
        </div>

      </div>

      <div class="section">
        <h2 class="section-title">Songs</h2>
        ${this.renderTrackTable(tracks)}
      </div>
    `;
  }

  renderAlbumPage(albumData) {

    const tracks =
      this.getAlbumTracks(
        albumData.name,
        albumData.artist
      );

    return `

      <div class="album-hero">

        <div
          class="detail-art"
          ${albumData.picture
            ? `style="background-image:url('${albumData.picture}')"`
            : ""}
        >
          ${albumData.picture ? "" : "♪"}
        </div>

        <div>
          <div class="detail-type">ALBUM</div>

          <h1 class="detail-title">
            ${this.escape(albumData.name)}
          </h1>

          <div class="detail-meta">
            ${this.escape(albumData.artist)}
             
            ${tracks.length}
            ${tracks.length === 1 ? "song" : "songs"}
          </div>

          <div class="detail-actions">
            <button
              class="play-circle"
              data-play-album="true"
            >
              ▶
            </button>
          </div>
        </div>

      </div>

      <div class="section">
        ${this.renderTrackTable(tracks)}
      </div>
    `;
  }

  renderPlaylistPage(playlist) {

    if (!playlist) {
      return this.emptyState(
        "Playlist not found",
        "This playlist no longer exists."
      );
    }

    const tracks =
      this.getPlaylistTracks(playlist);

    return `

      <div class="playlist-hero">

        <div class="detail-art">
          ♫
        </div>

        <div>
          <div class="detail-type">PLAYLIST</div>

          <h1 class="detail-title">
            ${this.escape(playlist.name)}
          </h1>

          <div class="detail-meta">
            ${tracks.length}
            ${tracks.length === 1 ? "song" : "songs"}
          </div>

          <div class="detail-actions">

            <button
              class="play-circle"
              data-play-playlist="true"
              ${tracks.length ? "" : "disabled"}
            >
              ▶
            </button>

            <button
              class="secondary-button"
              data-edit-playlist="true"
            >
              Edit
            </button>

            <button
              class="secondary-button"
              data-add-to-playlist="true"
            >
              Add Songs
            </button>

          </div>
        </div>

      </div>

      ${
        tracks.length
          ? this.renderTrackTable(
              tracks,
              true
            )
          : this.emptyState(
              "This playlist is empty",
              "Add songs from your library to start listening."
            )
      }
    `;
  }

  renderSearch() {

    const tracks =
      this.getSearchResults();

    const artistResults =
      this.getArtists()
        .filter(artist =>
          artist.name
            .toLowerCase()
            .includes(this.searchQuery)
        )
        .slice(0,6);

    const albumResults =
      this.getAlbums()
        .filter(album =>
          `${album.name} ${album.artist}`
            .toLowerCase()
            .includes(this.searchQuery)
        )
        .slice(0,6);

    return `

      <div class="page-header">
        <div>
          <div class="page-kicker">SEARCH</div>
          <h1 class="page-title">
            ${this.escape(this.searchQuery)}
          </h1>
        </div>
      </div>

      ${
        artistResults.length
          ? `
            <div class="section">
              <h2 class="section-title">Artists</h2>
              <div class="artist-grid">
                ${artistResults.map(
                  artist => this.artistCard(artist)
                ).join("")}
              </div>
            </div>
          `
          : ""
      }

      ${
        albumResults.length
          ? `
            <div class="section">
              <h2 class="section-title">Albums</h2>
              <div class="album-grid">
                ${albumResults.map(
                  album => this.albumCard(album)
                ).join("")}
              </div>
            </div>
          `
          : ""
      }

      <div class="section">
        <h2 class="section-title">
          Songs
        </h2>

        ${
          tracks.length
            ? this.renderTrackTable(tracks)
            : `
              <div class="empty-state">
                No songs found.
              </div>
            `
        }
      </div>
    `;
  }

  renderTrackTable(tracks, playlistMode = false) {

    return `
      <table class="track-table">

        <thead>
          <tr>
            <th>#</th>
            <th>TITLE</th>
            <th>ARTIST</th>
            <th>ALBUM</th>
            <th></th>
          </tr>
        </thead>

        <tbody>

          ${tracks.map((track,index) => {

            const actualIndex =
              this.queue.findIndex(
                item => item.id === track.id
              );

            const active =
              this.currentTrack &&
              this.currentTrack.id === track.id;

            return `

              <tr
                class="track-row ${active ? "active" : ""}"
                data-track-id="${track.id}"
                data-playlist-mode="${playlistMode}"
              >

                <td>
                  ${
                    active
                      ? "▶"
                      : index + 1
                  }
                </td>

                <td>
                  <div class="track-main">

                    <div
                      class="track-art"
                      ${
                        track.picture
                          ? `style="background-image:url('${track.picture}')"`
                          : ""
                      }
                    >
                      ${track.picture ? "" : "♪"}
                    </div>

                    <div class="track-meta">
                      <div class="track-title">
                        ${this.escape(track.title)}
                      </div>

                      <div class="track-subtitle">
                        ${this.escape(track.album)}
                      </div>
                    </div>

                  </div>
                </td>

                <td>
                  <button
                    class="artist-link"
                    data-artist="${this.escapeAttribute(track.artist)}"
                  >
                    ${this.escape(track.artist)}
                  </button>
                </td>

                <td>
                  <button
                    class="album-link"
                    data-album-name="${this.escapeAttribute(track.album)}"
                    data-album-artist="${this.escapeAttribute(track.artist)}"
                  >
                    ${this.escape(track.album)}
                  </button>
                </td>

                <td>
                  <button
                    class="row-menu"
                    data-track-menu="${track.id}"
                  >
                       
                  </button>
                </td>

              </tr>
            `;
          }).join("")}

        </tbody>
      </table>

      <div class="track-play-all-helper hidden">
        ${tracks.map(track => track.id).join(",")}
      </div>
    `;
  }

  artistCard(artist) {

    return `

      <article
        class="artist-card"
        data-artist-card="${this.escapeAttribute(artist.name)}"
      >

        <div
          class="card-art"
          ${
            artist.picture
              ? `style="background-image:url('${artist.picture}')"`
              : ""
          }
        >
          ${artist.picture ? "" : "◎"}
        </div>

        <div class="card-title">
          ${this.escape(artist.name)}
        </div>

        <div class="card-subtitle">
          ${artist.tracks.length}
          ${artist.tracks.length === 1 ? "song" : "songs"}
        </div>

      </article>
    `;
  }

  albumCard(album) {

    return `

      <article
        class="album-card"
        data-album-card="${this.escapeAttribute(album.name)}"
        data-album-artist-card="${this.escapeAttribute(album.artist)}"
      >

        <div
          class="card-art"
          ${
            album.picture
              ? `style="background-image:url('${album.picture}')"`
              : ""
          }
        >
          ${album.picture ? "" : "♪"}
        </div>

        <div class="card-title">
          ${this.escape(album.name)}
        </div>

        <div class="card-subtitle">
          ${this.escape(album.artist)}
        </div>

      </article>
    `;
  }

  bindTrackRows(container) {

    container
      .querySelectorAll(".track-row")
      .forEach(row => {

        row.addEventListener("click", event => {

          if (
            event.target.closest(".artist-link") ||
            event.target.closest(".album-link") ||
            event.target.closest(".row-menu")
          ) {
            return;
          }

          const track =
            this.library.find(
              item =>
                item.id === row.dataset.trackId
            );

          if (!track) {
            return;
          }

          const tracks =
            [...row.closest("tbody").querySelectorAll(".track-row")]
              .map(item =>
                this.library.find(
                  trackItem =>
                    trackItem.id === item.dataset.trackId
                )
              )
              .filter(Boolean);

          const index =
            tracks.findIndex(
              item => item.id === track.id
            );

          this.playTrack(
            track,
            tracks,
            index
          );
        });
      });

    container
      .querySelectorAll("[data-artist]")
      .forEach(button => {

        button.addEventListener("click", event => {

          event.stopPropagation();

          this.openArtist(
            button.dataset.artist
          );
        });
      });

    container
      .querySelectorAll("[data-album-name]")
      .forEach(button => {

        button.addEventListener("click", event => {

          event.stopPropagation();

          this.openAlbum(
            button.dataset.albumName,
            button.dataset.albumArtist
          );
        });
      });

    container
      .querySelectorAll("[data-track-menu]")
      .forEach(button => {

        button.addEventListener("click", event => {

          event.stopPropagation();

          this.openTrackMenu(
            button.dataset.trackMenu,
            event.clientX,
            event.clientY
          );
        });
      });

    const playAll =
      container.querySelector("[data-play-all]");

    if (playAll) {

      playAll.addEventListener("click", () => {

        const rows =
          [...container.querySelectorAll(".track-row")];

        const tracks =
          rows
            .map(row =>
              this.library.find(
                track =>
                  track.id === row.dataset.trackId
              )
            )
            .filter(Boolean);

        if (tracks.length) {
          this.playTrack(
            tracks[0],
            tracks,
            0
          );
        }
      });
    }

    const artistPlay =
      container.querySelector("[data-play-artist]");

    if (artistPlay) {

      artistPlay.addEventListener("click", () => {

        const tracks =
          this.getArtistTracks(
            this.selectedArtist
          );

        if (tracks.length) {
          this.playTrack(
            tracks[0],
            tracks,
            0
          );
        }
      });
    }

    const albumPlay =
      container.querySelector("[data-play-album]");

    if (albumPlay) {

      albumPlay.addEventListener("click", () => {

        const tracks =
          this.getAlbumTracks(
            this.selectedAlbum.name,
            this.selectedAlbum.artist
          );

        if (tracks.length) {
          this.playTrack(
            tracks[0],
            tracks,
            0
          );
        }
      });
    }

    const playlistPlay =
      container.querySelector(
        "[data-play-playlist]"
      );

    if (playlistPlay) {

      playlistPlay.addEventListener("click", () => {

        const tracks =
          this.getPlaylistTracks(
            this.selectedPlaylist
          );

        if (tracks.length) {
          this.playTrack(
            tracks[0],
            tracks,
            0
          );
        }
      });
    }
  }

  bindArtistCards(container) {

    container
      .querySelectorAll("[data-artist-card]")
      .forEach(card => {

        card.addEventListener("click", () => {

          this.openArtist(
            card.dataset.artistCard
          );
        });
      });
  }

  bindAlbumCards(container) {

    container
      .querySelectorAll("[data-album-card]")
      .forEach(card => {

        card.addEventListener("click", () => {

          this.openAlbum(
            card.dataset.albumCard,
            card.dataset.albumArtistCard
          );
        });
      });
  }

  bindPlaylistActions(container) {

    const edit =
      container.querySelector(
        "[data-edit-playlist]"
      );

    if (edit) {
      edit.addEventListener("click", () => {
        this.openPlaylistEditor(
          this.selectedPlaylist.id
        );
      });
    }

    const add =
      container.querySelector(
        "[data-add-to-playlist]"
      );

    if (add) {
      add.addEventListener("click", () => {
        this.openAddSongsToPlaylist(
          this.selectedPlaylist.id
        );
      });
    }
  }

  openArtist(name) {

    this.selectedArtist = name;

    this.setActiveNavigation("artists");

    this.currentView = "artist";

    this.renderView("artist");
  }

  openAlbum(name, artist) {

    this.selectedAlbum = {
      name,
      artist,
      picture:
        this.getAlbumTracks(name,artist)[0]?.picture ||
        null
    };

    this.currentView = "album";

    this.setActiveNavigation("albums");

    this.renderView("album");
  }

  openPlaylist(id) {

    const playlist =
      this.playlists.find(
        item => item.id === id
      );

    if (!playlist) {
      return;
    }

    this.selectedPlaylist = playlist;

    this.currentView = "playlist";

    this.setActiveNavigation("");

    this.renderView("playlist");

    this.closeLibrarySheet();
  }

  createPlaylist() {

    const name =
      window.prompt(
        "Playlist name"
      );

    if (!name || !name.trim()) {
      return;
    }

    const playlist = {
      id: crypto.randomUUID(),
      name: name.trim(),
      trackIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.playlists.push(playlist);

    this.dbPut(
      "playlists",
      playlist
    ).then(() => {

      this.renderPlaylists();
      this.renderMobilePlaylists();

      this.openPlaylist(
        playlist.id
      );
    });
  }

  async deletePlaylist(id) {

    const playlist =
      this.playlists.find(
        item => item.id === id
      );

    if (!playlist) {
      return;
    }

    if (
      !confirm(
        `Delete "${playlist.name}"?`
      )
    ) {
      return;
    }

    await this.dbDelete(
      "playlists",
      id
    );

    this.playlists =
      this.playlists.filter(
        item => item.id !== id
      );

    this.renderPlaylists();
    this.renderMobilePlaylists();

    if (
      this.selectedPlaylist &&
      this.selectedPlaylist.id === id
    ) {
      this.selectedPlaylist = null;
      this.currentView = "home";
      this.renderView("home");
    }
  }

  async renamePlaylist(id) {

    const playlist =
      this.playlists.find(
        item => item.id === id
      );

    if (!playlist) {
      return;
    }

    const name =
      prompt(
        "New playlist name",
        playlist.name
      );

    if (!name || !name.trim()) {
      return;
    }

    playlist.name =
      name.trim();

    playlist.updatedAt =
      Date.now();

    await this.dbPut(
      "playlists",
      playlist
    );

    this.selectedPlaylist =
      playlist;

    this.renderPlaylists();
    this.renderMobilePlaylists();
    this.renderView("playlist");
  }

  async addTrackToPlaylist(
    playlistId,
    trackId
  ) {

    const playlist =
      this.playlists.find(
        item => item.id === playlistId
      );

    if (!playlist) {
      return;
    }

    if (
      playlist.trackIds.includes(trackId)
    ) {
      return;
    }

    playlist.trackIds.push(trackId);

    playlist.updatedAt =
      Date.now();

    await this.dbPut(
      "playlists",
      playlist
    );

    this.selectedPlaylist =
      playlist;

    this.renderPlaylists();
    this.renderMobilePlaylists();

    if (this.currentView === "playlist") {
      this.renderView("playlist");
    }
  }

  async removeTrackFromPlaylist(
    playlistId,
    trackId
  ) {

    const playlist =
      this.playlists.find(
        item => item.id === playlistId
      );

    if (!playlist) {
      return;
    }

    playlist.trackIds =
      playlist.trackIds.filter(
        id => id !== trackId
      );

    playlist.updatedAt =
      Date.now();

    await this.dbPut(
      "playlists",
      playlist
    );

    this.selectedPlaylist =
      playlist;

    this.renderView("playlist");
  }

  async movePlaylistTrack(
    playlistId,
    index,
    direction
  ) {

    const playlist =
      this.playlists.find(
        item => item.id === playlistId
      );

    if (!playlist) {
      return;
    }

    const target =
      index + direction;

    if (
      target < 0 ||
      target >= playlist.trackIds.length
    ) {
      return;
    }

    const temp =
      playlist.trackIds[index];

    playlist.trackIds[index] =
      playlist.trackIds[target];

    playlist.trackIds[target] =
      temp;

    playlist.updatedAt =
      Date.now();

    await this.dbPut(
      "playlists",
      playlist
    );

    this.selectedPlaylist =
      playlist;

    this.renderView("playlist");
  }

  renderPlaylists() {

    const container =
      document.getElementById(
        "playlist-list"
      );

    container.innerHTML =
      this.playlists.map(
        playlist => `

          <button
            class="playlist-item ${
              this.selectedPlaylist &&
              this.selectedPlaylist.id === playlist.id
                ? "active"
                : ""
            }"
            data-playlist-id="${playlist.id}"
          >

            <span class="playlist-item-icon">
              ♫
            </span>

            <span class="playlist-item-name">
              ${this.escape(playlist.name)}
            </span>

          </button>

        `
      ).join("");

    container
      .querySelectorAll("[data-playlist-id]")
      .forEach(button => {

        button.addEventListener("click", () => {

          this.openPlaylist(
            button.dataset.playlistId
          );
        });
      });
  }

  renderMobilePlaylists() {

    const container =
      document.getElementById(
        "mobile-playlist-list"
      );

    container.innerHTML =
      this.playlists.map(
        playlist => `

          <button
            class="playlist-item"
            data-mobile-playlist-id="${playlist.id}"
          >

            <span class="playlist-item-icon">
              ♫
            </span>

            <span class="playlist-item-name">
              ${this.escape(playlist.name)}
            </span>

          </button>
        `
      ).join("");

    container
      .querySelectorAll(
        "[data-mobile-playlist-id]"
      )
      .forEach(button => {

        button.addEventListener("click", () => {

          this.openPlaylist(
            button.dataset.mobilePlaylistId
          );
        });
      });
  }

  openTrackMenu(
    trackId,
    x,
    y
  ) {

    const track =
      this.library.find(
        item => item.id === trackId
      );

    if (!track) {
      return;
    }

    const menu =
      document.getElementById(
        "context-menu"
      );

    menu.innerHTML = `

      <div class="context-title">
        ADD TO PLAYLIST
      </div>

      ${
        this.playlists.length
          ? this.playlists.map(
              playlist => `

                <button
                  class="context-item"
                  data-context-playlist="${playlist.id}"
                >
                  ♫ ${this.escape(playlist.name)}
                </button>

              `
            ).join("")
          : `
            <button
              class="context-item"
              data-create-from-menu="true"
            >
              ＋ Create Playlist
            </button>
          `
      }

      ${
        this.currentView === "playlist"
          ? `
            <button
              class="context-item"
              data-remove-current-playlist="${track.id}"
            >
              Remove from this playlist
            </button>
          `
          : ""
      }

    `;

    menu.style.left =
      `${Math.min(
        x,
        window.innerWidth - 235
      )}px`;

    menu.style.top =
      `${Math.min(
        y,
        window.innerHeight - 250
      )}px`;

    menu.classList.remove(
      "hidden"
    );

    menu
      .querySelectorAll(
        "[data-context-playlist]"
      )
      .forEach(button => {

        button.addEventListener(
          "click",
          async () => {

            await this.addTrackToPlaylist(
              button.dataset.contextPlaylist,
              track.id
            );

            menu.classList.add("hidden");
          }
        );
      });

    const create =
      menu.querySelector(
        "[data-create-from-menu]"
      );

    if (create) {

      create.addEventListener(
        "click",
        () => {
          menu.classList.add("hidden");
          this.createPlaylist();
        }
      );
    }

    const remove =
      menu.querySelector(
        "[data-remove-current-playlist]"
      );

    if (remove) {

      remove.addEventListener(
        "click",
        async () => {

          await this.removeTrackFromPlaylist(
            this.selectedPlaylist.id,
            track.id
          );

          menu.classList.add("hidden");
        }
      );
    }
  }

  openAddSongsToPlaylist(
    playlistId
  ) {

    const playlist =
      this.playlists.find(
        item => item.id === playlistId
      );

    if (!playlist) {
      return;
    }

    const available =
      this.library.filter(
        track =>
          !playlist.trackIds.includes(
            track.id
          )
      );

    this.showModal(`

      <div class="modal-header">
        <h2>Add Songs</h2>
        <button class="close-button" data-close-modal>×</button>
      </div>

      <div class="playlist-editor">

        ${
          available.length
            ? available.map(
                track => `

                  <button
                    class="editor-track"
                    data-add-song-id="${track.id}"
                  >

                    <div
                      class="editor-track-art"
                      ${
                        track.picture
                          ? `style="background-image:url('${track.picture}')"`
                          : ""
                      }
                    ></div>

                    <div class="editor-track-info">
                      <strong>
                        ${this.escape(track.title)}
                      </strong>

                      <span>
                        ${this.escape(track.artist)}
                      </span>
                    </div>

                    <span>＋</span>

                  </button>
                `
              ).join("")
            : `
              <div class="empty-state">
                All songs are already in this playlist.
              </div>
            `
        }

      </div>
    `);

    document
      .querySelector("[data-close-modal]")
      .addEventListener("click", () => {
        this.closeModal();
      });

    document
      .querySelectorAll("[data-add-song-id]")
      .forEach(button => {

        button.addEventListener(
          "click",
          async () => {

            await this.addTrackToPlaylist(
              playlistId,
              button.dataset.addSongId
            );

            button.remove();

            if (
              !document.querySelector(
                "[data-add-song-id]"
              )
            ) {
              this.closeModal();
            }
          }
        );
      });
  }

  openPlaylistEditor(id) {

    const playlist =
      this.playlists.find(
        item => item.id === id
      );

    if (!playlist) {
      return;
    }

    const tracks =
      this.getPlaylistTracks(
        playlist
      );

    this.showModal(`

      <div class="modal-header">
        <h2>Edit Playlist</h2>
        <button
          class="close-button"
          data-close-modal
        >
          ×
        </button>
      </div>

      <div class="playlist-editor">

        ${
          tracks.length
            ? tracks.map(
                (track,index) => `

                  <div class="editor-track">

                    <div
                      class="editor-track-art"
                      ${
                        track.picture
                          ? `style="background-image:url('${track.picture}')"`
                          : ""
                      }
                    ></div>

                    <div class="editor-track-info">
                      <strong>
                        ${this.escape(track.title)}
                      </strong>

                      <span>
                        ${this.escape(track.artist)}
                      </span>
                    </div>

                    <div class="editor-track-actions">

                      <button
                        data-move-up="${index}"
                        title="Move Up"
                      >
                        ↑
                      </button>

                      <button
                        data-move-down="${index}"
                        title="Move Down"
                      >
                        ↓
                      </button>

                      <button
                        data-remove-track="${track.id}"
                        title="Remove"
                      >
                        ×
                      </button>

                    </div>

                  </div>
                `
              ).join("")
            : `
              <div class="empty-state">
                This playlist is empty.
              </div>
            `
        }

      </div>

      <div class="modal-actions">

        <button
          class="secondary-button"
          data-rename-playlist
        >
          Rename
        </button>

        <button
          class="secondary-button"
          data-delete-playlist
        >
          Delete Playlist
        </button>

      </div>
    `);

    document
      .querySelector("[data-close-modal]")
      .addEventListener("click", () => {
        this.closeModal();
      });

    document
      .querySelectorAll("[data-move-up]")
      .forEach(button => {

        button.addEventListener("click", async () => {

          await this.movePlaylistTrack(
            id,
            Number(button.dataset.moveUp),
            -1
          );

          this.openPlaylistEditor(id);
        });
      });

    document
      .querySelectorAll("[data-move-down]")
      .forEach(button => {

        button.addEventListener("click", async () => {

          await this.movePlaylistTrack(
            id,
            Number(button.dataset.moveDown),
            1
          );

          this.openPlaylistEditor(id);
        });
      });

    document
      .querySelectorAll("[data-remove-track]")
      .forEach(button => {

        button.addEventListener("click", async () => {

          await this.removeTrackFromPlaylist(
            id,
            button.dataset.removeTrack
          );

          this.openPlaylistEditor(id);
        });
      });

    document
      .querySelector("[data-rename-playlist]")
      .addEventListener("click", () => {

        this.closeModal();

        this.renamePlaylist(id);
      });

    document
      .querySelector("[data-delete-playlist]")
      .addEventListener("click", () => {

        this.closeModal();

        this.deletePlaylist(id);
      });
  }

  openEqualizer() {

    this.showModal(`

      <div class="modal-header">
        <h2>Equalizer</h2>

        <button
          class="close-button"
          data-close-modal
        >
          ×
        </button>
      </div>

      <div class="eq-controls">

        <label>
          <input
            id="eq-enabled"
            type="checkbox"
            checked
          >
          Enable EQ
        </label>

        <select
          id="eq-preset"
          class="form-input"
          style="width:auto"
        >
          <option value="flat">Flat</option>
          <option value="bass">Bass Boost</option>
          <option value="vocal">Vocal</option>
          <option value="rock">Rock</option>
          <option value="pop">Pop</option>
          <option value="classical">Classical</option>
        </select>

      </div>

      <div class="eq-sliders">

        ${[
          "60",
          "120",
          "250",
          "500",
          "1k",
          "2k",
          "4k",
          "8k",
          "16k"
        ].map(
          (frequency,index) => `

            <div class="eq-band">

              <input
                type="range"
                min="-12"
                max="12"
                step=".5"
                value="0"
                data-eq="${index}"
              >

              <span>${frequency}</span>

            </div>

          `
        ).join("")}

      </div>
    `);

    document
      .querySelector("[data-close-modal]")
      .addEventListener("click", () => {
        this.closeModal();
      });

    document
      .querySelectorAll("[data-eq]")
      .forEach(input => {

        input.addEventListener(
          "input",
          () => {

            const index =
              Number(input.dataset.eq);

            this.eqFilters[index].gain.value =
              Number(input.value);
          }
        );
      });

    document
      .getElementById("eq-preset")
      .addEventListener(
        "change",
        event => {

          const preset =
            this.presets[
              event.target.value
            ];

          preset.forEach(
            (value,index) => {

              this.eqFilters[index].gain.value =
                value;

              const input =
                document.querySelector(
                  `[data-eq="${index}"]`
                );

              input.value = value;
            }
          );
        }
      );

    document
      .getElementById("eq-enabled")
      .addEventListener(
        "change",
        event => {

          this.eqFilters.forEach(
            filter => {

              filter.gain.value =
                event.target.checked
                  ? filter.gain.value
                  : 0;
            }
          );
        }
      );
  }

  openSettings() {

    this.showModal(`

      <div class="modal-header">
        <h2>Settings</h2>

        <button
          class="close-button"
          data-close-modal
        >
          ×
        </button>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">

        <button
          class="secondary-button"
          data-reset-library
        >
          Reset Library
        </button>

        <p style="
          color:var(--text-muted);
          font-size:11px;
          line-height:1.7;
        ">
          This removes all locally stored music,
          playlists and library data from this browser.
        </p>

      </div>
    `);

    document
      .querySelector("[data-close-modal]")
      .addEventListener("click", () => {
        this.closeModal();
      });

    document
      .querySelector("[data-reset-library]")
      .addEventListener("click", async () => {

        if (
          !confirm(
            "Reset Amber library?"
          )
        ) {
          return;
        }

        indexedDB.deleteDatabase(
          "AmberMusicDB_v3"
        );

        localStorage.removeItem(
          "amber-liked"
        );

        location.reload();
      });
  }

  showModal(html) {

    document
      .getElementById("modal-content")
      .innerHTML = html;

    document
      .getElementById("modal")
      .classList.remove("hidden");
  }

  closeModal() {

    document
      .getElementById("modal")
      .classList.add("hidden");
  }

  openLibrarySheet() {

    document
      .getElementById(
        "mobile-library-sheet"
      )
      .classList.remove("hidden");
  }

  closeLibrarySheet() {

    document
      .getElementById(
        "mobile-library-sheet"
      )
      .classList.add("hidden");
  }

  openNowPlaying() {

    document
      .getElementById(
        "now-playing-modal"
      )
      .classList.remove("hidden");

    this.updatePlayer();
  }

  closeNowPlaying() {

    document
      .getElementById(
        "now-playing-modal"
      )
      .classList.add("hidden");
  }

  toggleLike() {

    if (!this.currentTrack) {
      return;
    }

    if (
      this.likedTracks.has(
        this.currentTrack.id
      )
    ) {

      this.likedTracks.delete(
        this.currentTrack.id
      );

    } else {

      this.likedTracks.add(
        this.currentTrack.id
      );
    }

    this.savePreferences();

    this.updatePlayer();
  }

  updatePlayer() {

    const track =
      this.currentTrack;

    const title =
      document.getElementById(
        "player-title"
      );

    const artist =
      document.getElementById(
        "player-artist"
      );

    const art =
      document.getElementById(
        "player-art"
      );

    const mobileTitle =
      document.getElementById(
        "mobile-player-title"
      );

    const mobileArtist =
      document.getElementById(
        "mobile-player-artist"
      );

    const mobileArt =
      document.getElementById(
        "mobile-player-art"
      );

    const nowTitle =
      document.getElementById(
        "now-playing-title"
      );

    const nowArtist =
      document.getElementById(
        "now-playing-artist"
      );

    const nowArt =
      document.getElementById(
        "now-playing-art"
      );

    if (!track) {

      title.textContent =
        "Not Playing";

      artist.textContent =
        "—";

      mobileTitle.textContent =
        "Not Playing";

      mobileArtist.textContent =
        "—";

      nowTitle.textContent =
        "Not Playing";

      nowArtist.textContent =
        "—";

      art.style.backgroundImage =
        "none";

      mobileArt.style.backgroundImage =
        "none";

      nowArt.style.backgroundImage =
        "none";

    } else {

      title.textContent =
        track.title;

      artist.textContent =
        track.artist;

      mobileTitle.textContent =
        track.title;

      mobileArtist.textContent =
        track.artist;

      nowTitle.textContent =
        track.title;

      nowArtist.textContent =
        track.artist;

      const background =
        track.picture
          ? `url("${track.picture}")`
          : "none";

      art.style.backgroundImage =
        background;

      mobileArt.style.backgroundImage =
        background;

      nowArt.style.backgroundImage =
        background;
    }

    const playing =
      track &&
      !this.audio.paused;

    document.getElementById(
      "play-icon"
    ).textContent =
      playing ? "Ⅱ" : "▶";

    document.getElementById(
      "mobile-player-play"
    ).textContent =
      playing ? "Ⅱ" : "▶";

    document.getElementById(
      "mobile-play"
    ).textContent =
      playing ? "Ⅱ" : "▶";

    const liked =
      track &&
      this.likedTracks.has(
        track.id
      );

    document
      .getElementById("player-like")
      .classList.toggle(
        "liked",
        liked
      );

    document.getElementById(
      "player-like"
    ).textContent =
      liked ? "♥" : "♡";

    document
      .getElementById("mobile-player")
      .classList.toggle(
        "hidden",
        !track
      );

    this.updatePlaybackButtons();
  }

  updatePlaybackButtons() {

    document
      .getElementById("shuffle")
      .classList.toggle(
        "active",
        this.shuffle
      );

    document
      .getElementById("mobile-shuffle")
      .classList.toggle(
        "active",
        this.shuffle
      );

    document
      .getElementById("repeat")
      .classList.toggle(
        "active",
        this.repeat !== "off"
      );

    document
      .getElementById("mobile-repeat")
      .classList.toggle(
        "active",
        this.repeat !== "off"
      );

    document
      .getElementById("repeat")
      .title =
      `Repeat: ${this.repeat}`;
  }

  updateProgress() {

    const current =
      this.audio.currentTime || 0;

    const duration =
      this.audio.duration || 0;

    const ratio =
      duration
        ? current / duration
        : 0;

    const percent =
      `${Math.min(100,ratio * 100)}%`;

    document
      .getElementById("progress-fill")
      .style.width =
      percent;

    document
      .getElementById("mobile-progress-fill")
      .style.width =
      percent;

    document
      .getElementById("now-playing-progress-fill")
      .style.width =
      percent;

    document
      .getElementById("current-time")
      .textContent =
      this.formatTime(current);

    document
      .getElementById("duration")
      .textContent =
      this.formatTime(duration);

    document
      .getElementById("now-playing-current")
      .textContent =
      this.formatTime(current);

    document
      .getElementById("now-playing-duration")
      .textContent =
      this.formatTime(duration);
  }

  renderQueue() {

    const current =
      document.getElementById(
        "queue-current"
      );

    const list =
      document.getElementById(
        "queue-list"
      );

    if (
      !this.currentTrack
    ) {

      current.innerHTML =
        "Nothing playing.";

    } else {

      current.innerHTML = `

        <strong>
          ${this.escape(
            this.currentTrack.title
          )}
        </strong>

        <br>

        <small>
          ${this.escape(
            this.currentTrack.artist
          )}
        </small>
      `;
    }

    const upcoming =
      this.queue.slice(
        this.queueIndex + 1
      );

    list.innerHTML =
      upcoming.map(
        (track,index) => `

          <div
            class="queue-item"
            data-queue-id="${track.id}"
          >

            <strong>
              ${this.escape(track.title)}
            </strong>

            <span>
              ${this.escape(track.artist)}
            </span>

          </div>
        `
      ).join("");

    list
      .querySelectorAll("[data-queue-id]")
      .forEach(item => {

        item.addEventListener(
          "click",
          () => {

            const index =
              this.queue.findIndex(
                track =>
                  track.id ===
                  item.dataset.queueId
              );

            if (index >= 0) {

              this.queueIndex =
                index;

              this.playTrack(
                this.queue[index]
              );
            }
          }
        );
      });
  }

  startVisualizer() {

    const canvas =
      document.getElementById(
        "visualizer"
      );

    const ctx =
      canvas.getContext("2d");

    const bufferLength =
      this.analyserNode.frequencyBinCount;

    const data =
      new Uint8Array(
        bufferLength
      );

    const draw = () => {

      requestAnimationFrame(draw);

      this.analyserNode
        .getByteFrequencyData(data);

      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      const width =
        canvas.width /
        bufferLength;

      for (
        let i = 0;
        i < bufferLength;
        i++
      ) {

        const height =
          (data[i] / 255) *
          canvas.height;

        ctx.fillStyle =
          "rgba(255,203,122,.72)";

        ctx.fillRect(
          i * width,
          canvas.height - height,
          Math.max(1,width - 1),
          height
        );
      }
    };

    draw();
  }

  emptyLibrary() {

    return `
      <div class="empty-state">

        <div class="empty-icon">
          ♫
        </div>

        <h2>Your library is empty</h2>

        <p>
          Add local audio files to start building
          your Amber library.
        </p>

        <button
          class="primary-button"
          id="empty-add-music"
        >
          Add Music
        </button>

      </div>
    `;
  }

  emptyState(title,description) {

    return `
      <div class="empty-state">

        <div class="empty-icon">
          ♫
        </div>

        <h2>
          ${this.escape(title)}
        </h2>

        <p>
          ${this.escape(description)}
        </p>

      </div>
    `;
  }

  escape(value) {

    return String(value ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  escapeAttribute(value) {
    return this.escape(value);
  }

  formatTime(seconds) {

    if (
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      return "0:00";
    }

    const minutes =
      Math.floor(seconds / 60);

    const remaining =
      Math.floor(seconds % 60);

    return `${minutes}:${String(
      remaining
    ).padStart(2,"0")}`;
  }
}

document.addEventListener(
  "DOMContentLoaded",
  () => {
    window.amber =
      new AmberPlayer();
  }
);