/**
 * Built-in free API directory.
 *
 * A curated subset (≈120 entries) of the community list at
 * https://github.com/public-apis/public-apis (MIT licensed — see NOTICE
 * in this file's header notes). Every entry carries a concrete example
 * request so "Try it" can open a ready-to-send draft in the Requests
 * module instead of a bare URL.
 *
 * Entries are hand-picked for long-term stability and test-friendliness.
 * Add new ones via PR — the shape is deliberately small.
 *
 * Data notice: derived from the public-apis/public-apis README,
 * Copyright (c) its contributors, licensed under the MIT License.
 */

import type { ApiBody } from './apiTypes';

export type DirectoryAuth = 'none' | 'key' | 'bearer';

export interface DirectoryApi {
  id: string;
  name: string;
  description: string;
  category: string;
  /** 'none' — works out of the box; 'key'/'bearer' — needs credentials. */
  auth: DirectoryAuth;
  /** Whether the API answers browser CORS requests (web build). */
  cors: boolean;
  /** Example request used by "Try it". */
  example: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    headers?: [string, string][];
    body?: ApiBody;
    /** Shown in the panel when opening the draft (e.g. where the key goes). */
    note?: string;
  };
}

export interface DirectoryCategory {
  id: string;
  label: string;
}

export const DIRECTORY_CATEGORIES: DirectoryCategory[] = [
  { id: 'popular', label: 'Popular' },
  { id: 'development', label: 'Development' },
  { id: 'ai', label: 'AI' },
  { id: 'weather', label: 'Weather' },
  { id: 'music', label: 'Music' },
  { id: 'movies', label: 'Movies & TV' },
  { id: 'news', label: 'News & Reference' },
  { id: 'finance', label: 'Finance' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'games', label: 'Games' },
  { id: 'geo', label: 'Geography' },
  { id: 'sports', label: 'Sports' },
  { id: 'books', label: 'Books' },
  { id: 'images', label: 'Images' },
  { id: 'science', label: 'Science & Space' },
  { id: 'travel', label: 'Travel & Transit' },
  { id: 'health', label: 'Health' },
];

const none: ApiBody = { type: 'none', content: '', form: [], gqlVariables: '' };
const json = (content: string): ApiBody => ({ type: 'json', content, form: [], gqlVariables: '' });

/** Keep the file readable: `g` expands to the common GET/no-auth body. */
const G = none;

export const API_DIRECTORY: DirectoryApi[] = [
  /* ——— Popular ——— */
  { id: 'github', name: 'GitHub API', description: 'Repositories, users, issues and more from the world’s largest code host.', category: 'popular', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.github.com/repos/octocat/Hello-World', body: G } },
  { id: 'openai', name: 'OpenAI', description: 'Chat completions, embeddings and images — the de-facto LLM API.', category: 'popular', auth: 'bearer', cors: true, example: { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', headers: [['Content-Type', 'application/json']], body: json('{\n  "model": "gpt-4o-mini",\n  "messages": [\n    { "role": "user", "content": "Say hello in one sentence" }\n  ]\n}'), note: 'Set your key in the Authorization header via the Auth tab (Bearer {{apiKey}}), or paste it in the headers.' } },
  { id: 'httpbin', name: 'httpbin', description: 'HTTP request & response service — echoes back everything you send.', category: 'popular', auth: 'none', cors: true, example: { method: 'GET', url: 'https://httpbin.org/get', body: G } },
  { id: 'jsonplaceholder', name: 'JSONPlaceholder', description: 'Free fake REST API for testing and prototyping.', category: 'popular', auth: 'none', cors: true, example: { method: 'GET', url: 'https://jsonplaceholder.typicode.com/todos/1', body: G } },
  { id: 'reqres', name: 'Reqres', description: 'Hosted REST API for testing — mock users with real HTTP semantics.', category: 'popular', auth: 'none', cors: true, example: { method: 'GET', url: 'https://reqres.in/api/users/2', body: G } },
  { id: 'openweathermap', name: 'OpenWeatherMap', description: 'Current weather, forecasts and air quality for any city.', category: 'popular', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.openweathermap.org/data/2.5/weather?q=London&appid={{apiKey}}', body: G, note: 'Free key at openweathermap.org. Put it in the {{apiKey}} variable (Vars popover → Global).' } },
  { id: 'restcountries', name: 'REST Countries', description: 'Name, capital, currency, languages and flags of every country.', category: 'popular', auth: 'none', cors: true, example: { method: 'GET', url: 'https://restcountries.com/v3.1/name/germany', body: G } },
  { id: 'pokeapi', name: 'PokéAPI', description: 'All the Pokémon data you ever wanted, free and no key.', category: 'popular', auth: 'none', cors: true, example: { method: 'GET', url: 'https://pokeapi.co/api/v2/pokemon/pikachu', body: G } },
  { id: 'nasa', name: 'NASA APOD', description: 'Astronomy Picture of the Day — the most beautiful API out there.', category: 'popular', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.nasa.gov/planetary/apod?api_key={{apiKey}}', body: G, note: 'Free key at api.nasa.gov. Put it in the {{apiKey}} variable.' } },
  { id: 'randomuser', name: 'Random User Generator', description: 'Realistic random user profiles for UI mockups and tests.', category: 'popular', auth: 'none', cors: true, example: { method: 'GET', url: 'https://randomuser.me/api/', body: G } },

  /* ——— Development ——— */
  { id: 'ipify', name: 'ipify', description: 'Your public IP address as plain text or JSON.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.ipify.org?format=json', body: G } },
  { id: 'ipwhois', name: 'ipwho.is', description: 'IP geolocation, ISP and timezone from any address.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://ipwho.is/', body: G } },
  { id: 'postman-echo', name: 'Postman Echo', description: 'Echo endpoint that returns the request you sent — great for debugging.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://postman-echo.com/get?foo=bar', body: G } },
  { id: 'dummyjson', name: 'DummyJSON', description: 'Fake products, carts, users and quotes for prototyping.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://dummyjson.com/products/1', body: G } },
  { id: 'hackernews', name: 'Hacker News', description: 'Stories, comments and jobs from the official Firebase-backed API.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://hacker-news.firebaseio.com/v0/item/8863.json', body: G } },
  { id: 'dictionaryapi', name: 'Free Dictionary API', description: 'Definitions, phonetics and examples for English words.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.dictionaryapi.dev/api/v2/entries/en/hello', body: G } },
  { id: 'adviceslip', name: 'Advice Slip', description: 'Random pieces of (sometimes dubious) life advice.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.adviceslip.com/advice', body: G } },
  { id: 'httpcats', name: 'HTTP Cats', description: 'Every HTTP status code as a cat picture.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://http.cat/200', body: G } },
  { id: 'wikipedia', name: 'Wikipedia REST', description: 'Page summaries, extracts and metadata from Wikipedia.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://en.wikipedia.org/api/rest_v1/page/summary/JavaScript', body: G } },
  { id: 'reddit', name: 'Reddit (JSON)', description: 'Front-page and subreddit listings via the public JSON endpoints.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://www.reddit.com/r/programming/hot.json?limit=5', body: G } },
  { id: 'jokeapi', name: 'JokeAPI', description: 'Programmer, dark, pun and misc jokes with blacklist filters.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://v2.jokeapi.dev/joke/Programming?type=single', body: G } },
  { id: 'bored', name: 'Bored API', description: 'Suggests an activity when you have nothing to do.', category: 'development', auth: 'none', cors: true, example: { method: 'GET', url: 'https://www.boredapi.com/api/activity', body: G } },

  /* ——— AI ——— */
  { id: 'pollinations', name: 'Pollinations AI', description: 'Free image generation from a text prompt — no key, no signup.', category: 'ai', auth: 'none', cors: true, example: { method: 'GET', url: 'https://image.pollinations.ai/prompt/a%20red%20cat%20in%20space', body: G, note: 'Returns an image (PNG/JPEG) directly.' } },
  { id: 'groq', name: 'Groq', description: 'Blazing-fast open-model LLM inference (Llama, Mixtral).', category: 'ai', auth: 'bearer', cors: true, example: { method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions', headers: [['Content-Type', 'application/json']], body: json('{\n  "model": "llama-3.3-70b-versatile",\n  "messages": [{ "role": "user", "content": "Hello!" }]\n}'), note: 'Free key at console.groq.com — add Bearer auth in the Auth tab.' } },
  { id: 'ollama', name: 'Ollama (local)', description: 'Run LLMs on your own machine and call them over localhost.', category: 'ai', auth: 'none', cors: false, example: { method: 'POST', url: 'http://localhost:11434/api/generate', headers: [['Content-Type', 'application/json']], body: json('{\n  "model": "llama3.2",\n  "prompt": "Why is the sky blue?",\n  "stream": false\n}'), note: 'Requires Ollama running locally (ollama.com).' } },
  { id: 'api-ninjas-ai', name: 'API Ninjas (AI)', description: 'Key-value extraction, text classification and other AI utilities.', category: 'ai', auth: 'key', cors: true, example: { method: 'POST', url: 'https://api.api-ninjas.com/v1/textsummarizer', headers: [['X-Api-Key', '{{apiKey}}'], ['Content-Type', 'application/json']], body: json('{\n  "text": "Artificial intelligence is transforming software development by automating testing, documentation and code review, letting engineers focus on design and architecture."\n}'), note: 'Free key at api-ninjas.com.' } },
  { id: 'huggingface', name: 'Hugging Face Inference', description: 'Thousands of open models — text, image, audio — via one endpoint.', category: 'ai', auth: 'bearer', cors: true, example: { method: 'POST', url: 'https://api-inference.huggingface.co/models/gpt2', headers: [['Content-Type', 'application/json']], body: json('{\n  "inputs": "Once upon a time,"\n}'), note: 'Free token at huggingface.co — Bearer auth in the Auth tab.' } },
  { id: 'cohere', name: 'Cohere', description: 'Generate, embed, classify and rerank with enterprise-grade models.', category: 'ai', auth: 'bearer', cors: true, example: { method: 'POST', url: 'https://api.cohere.com/v2/chat', headers: [['Content-Type', 'application/json']], body: json('{\n  "model": "command-r-plus",\n  "messages": [{ "role": "user", "content": "Hello!" }]\n}'), note: 'Free trial key at dashboard.cohere.com.' } },
  { id: 'perplexity', name: 'Perplexity AI', description: 'Web-grounded answers with citations via the Sonar API.', category: 'ai', auth: 'bearer', cors: true, example: { method: 'POST', url: 'https://api.perplexity.ai/chat/completions', headers: [['Content-Type', 'application/json']], body: json('{\n  "model": "sonar",\n  "messages": [{ "role": "user", "content": "What is the capital of France?" }]\n}'), note: 'Key at perplexity.ai/settings/api.' } },
  { id: 'together', name: 'Together AI', description: 'Open-source model inference and fine-tuning at scale.', category: 'ai', auth: 'bearer', cors: true, example: { method: 'POST', url: 'https://api.together.xyz/v1/chat/completions', headers: [['Content-Type', 'application/json']], body: json('{\n  "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",\n  "messages": [{ "role": "user", "content": "Hello!" }]\n}'), note: 'Key at api.together.ai.' } },

  /* ——— Weather ——— */
  { id: 'open-meteo', name: 'Open-Meteo', description: 'Free weather forecasts without an API key — the open alternative.', category: 'weather', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current_weather=true', body: G } },
  { id: 'weatherapi', name: 'WeatherAPI.com', description: 'Current conditions, forecast and astronomy for any location.', category: 'weather', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.weatherapi.com/v1/current.json?key={{apiKey}}&q=Tokyo', body: G, note: 'Free key at weatherapi.com.' } },
  { id: 'weather-gov', name: 'Weather.gov', description: 'Official US National Weather Service forecasts and alerts.', category: 'weather', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.weather.gov/points/39.7456,-97.0892', body: G, note: 'US locations only.' } },
  { id: 'tomorrow', name: 'Tomorrow.io', description: 'Hyperlocal weather with minute-by-minute forecasts.', category: 'weather', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.tomorrow.io/v4/timelines?location=52.52,13.41&timesteps=1h&units=metric&apikey={{apiKey}}', body: G, note: 'Free tier at tomorrow.io.' } },
  { id: 'visualcrossing', name: 'Visual Crossing', description: 'Historical weather data back to 1970, plus forecasts.', category: 'weather', auth: 'key', cors: true, example: { method: 'GET', url: 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/Berlin?unitGroup=metric&key={{apiKey}}', body: G, note: 'Free tier at visualcrossing.com.' } },
  { id: 'aqicn', name: 'AQICN', description: 'Live air quality index from monitoring stations worldwide.', category: 'weather', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.waqi.info/feed/beijing/?token={{apiKey}}', body: G, note: 'Free token at aqicn.org.' } },

  /* ——— Music ——— */
  { id: 'itunes', name: 'iTunes Search', description: 'Search songs, albums, movies and podcasts in the Apple catalog.', category: 'music', auth: 'none', cors: true, example: { method: 'GET', url: 'https://itunes.apple.com/search?term=beatles&limit=5', body: G } },
  { id: 'deezer', name: 'Deezer', description: 'Search tracks, albums and artists across Deezer’s catalog.', category: 'music', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.deezer.com/search?q=eminem&limit=5', body: G } },
  { id: 'musicbrainz', name: 'MusicBrainz', description: 'The open music encyclopedia — artists, releases, recordings.', category: 'music', auth: 'none', cors: true, example: { method: 'GET', url: 'https://musicbrainz.org/ws/2/artist/5b11f4ce-a62d-471e-81fc-a69a8278c7da?fmt=json', body: G } },
  { id: 'lastfm', name: 'Last.fm', description: 'Track scrobbles, artist info and similar-artist recommendations.', category: 'music', auth: 'key', cors: true, example: { method: 'GET', url: 'https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=Radiohead&api_key={{apiKey}}&format=json', body: G, note: 'Free key at last.fm/api.' } },
  { id: 'spotify', name: 'Spotify Web API', description: 'Tracks, playlists and recommendations from Spotify.', category: 'music', auth: 'bearer', cors: true, example: { method: 'GET', url: 'https://api.spotify.com/v1/search?q=radiohead&type=track&limit=5', body: G, note: 'Needs a Spotify app + OAuth token — Bearer auth in the Auth tab.' } },
  { id: 'audiodb', name: 'TheAudioDB', description: 'Artist details, album covers and track metadata.', category: 'music', auth: 'key', cors: true, example: { method: 'GET', url: 'https://www.theaudiodb.com/api/v1/json/{{apiKey}}/search.php?s=queen', body: G, note: 'Free demo key: 2 (use it as the variable value) — or register at theaudiodb.com.' } },
  { id: 'genius', name: 'Genius', description: 'Song lyrics and annotated explanations.', category: 'music', auth: 'bearer', cors: true, example: { method: 'GET', url: 'https://api.genius.com/search?q=bohemian%20rhapsody', body: G, note: 'Client access token at genius.com/api-clients.' } },

  /* ——— Movies & TV ——— */
  { id: 'tvmaze', name: 'TVmaze', description: 'TV show schedules, episodes and cast — free and open.', category: 'movies', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.tvmaze.com/search/shows?q=breaking%20bad', body: G } },
  { id: 'jikan', name: 'Jikan', description: 'Unofficial MyAnimeList API — anime, manga and character data.', category: 'movies', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.jikan.moe/v4/anime?q=naruto&limit=3', body: G } },
  { id: 'omdb', name: 'OMDb', description: 'Movie information from IMDb — ratings, plots, posters.', category: 'movies', auth: 'key', cors: true, example: { method: 'GET', url: 'https://www.omdbapi.com/?t=inception&apikey={{apiKey}}', body: G, note: 'Free key at omdbapi.com/apikey.aspx.' } },
  { id: 'tmdb', name: 'The Movie Database', description: 'Movies, TV and cast data powering most fan apps.', category: 'movies', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.themoviedb.org/3/movie/550?api_key={{apiKey}}', body: G, note: 'Free key at themoviedb.org — requires registration.' } },
  { id: 'filmweb', name: 'Studio Ghibli API', description: 'Films, people and locations from Studio Ghibli.', category: 'movies', auth: 'none', cors: true, example: { method: 'GET', url: 'https://ghibliapi.vercel.app/films', body: G } },
  { id: 'watchmode', name: 'Watchmode', description: 'Where to stream any movie or show, with metadata.', category: 'movies', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.watchmode.com/v1/search/?searchValue=matrix&apiKey={{apiKey}}', body: G, note: 'Free tier at watchmode.com.' } },

  /* ——— News & Reference ——— */
  { id: 'newsapi', name: 'NewsAPI', description: 'Headlines and articles from 150,000+ sources worldwide.', category: 'news', auth: 'key', cors: true, example: { method: 'GET', url: 'https://newsapi.org/v2/top-headlines?country=us&apiKey={{apiKey}}', body: G, note: 'Free key at newsapi.org (localhost only in the free tier).' } },
  { id: 'gnews', name: 'GNews', description: 'Global news search with topic and country filters.', category: 'news', auth: 'key', cors: true, example: { method: 'GET', url: 'https://gnews.io/api/v4/top-headlines?country=us&token={{apiKey}}', body: G, note: 'Free key at gnews.io.' } },
  { id: 'spaceflightnews', name: 'Spaceflight News', description: 'The latest spaceflight news, launches and articles.', category: 'news', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.spaceflightnewsapi.net/v4/articles/?limit=3', body: G } },
  { id: 'guardian', name: 'The Guardian', description: 'News content API from one of the world’s major newspapers.', category: 'news', auth: 'key', cors: true, example: { method: 'GET', url: 'https://content.guardianapis.com/search?q=climate&api-key={{apiKey}}', body: G, note: 'Free key at open-platform.theguardian.com.' } },
  { id: 'quotable', name: 'Quotable', description: 'Random quotes by famous authors, searchable.', category: 'news', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.quotable.io/quotes/random', body: G } },
  { id: 'frankfurter', name: 'Frankfurter', description: 'Daily exchange rates from the European Central Bank — no key.', category: 'news', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.frankfurter.app/latest?from=USD&to=EUR', body: G } },
  { id: 'metmuseum', name: 'The Met Museum', description: 'Public-domain artworks and object metadata from the Met.', category: 'news', auth: 'none', cors: true, example: { method: 'GET', url: 'https://collectionapi.metmuseum.org/public/collection/v1/objects/436535', body: G } },

  /* ——— Finance ——— */
  { id: 'coinbase', name: 'Coinbase Exchange', description: 'Live cryptocurrency prices and order books.', category: 'finance', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.exchange.coinbase.com/products/BTC-USD/ticker', body: G } },
  { id: 'binance', name: 'Binance Public', description: 'Market data — prices, klines and depth — no key needed.', category: 'finance', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', body: G } },
  { id: 'exchangerate', name: 'ExchangeRate-API', description: 'Conversion rates for 160+ currencies — the open endpoint needs no key.', category: 'finance', auth: 'none', cors: true, example: { method: 'GET', url: 'https://open.er-api.com/v6/latest/USD', body: G } },
  { id: 'twelvedata', name: 'Twelve Data', description: 'Stock, forex and crypto quotes with chart data.', category: 'finance', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.twelvedata.com/time_series?symbol=AAPL&interval=1day&apikey={{apiKey}}', body: G, note: 'Free key at twelvedata.com.' } },
  { id: 'finnhub', name: 'Finnhub', description: 'Stock candles, company news and financials.', category: 'finance', auth: 'key', cors: true, example: { method: 'GET', url: 'https://finnhub.io/api/v1/quote?symbol=AAPL&token={{apiKey}}', body: G, note: 'Free key at finnhub.io.' } },
  { id: 'iexcloud', name: 'IEX Cloud', description: 'Stock market data for US equities and ETFs.', category: 'finance', auth: 'key', cors: true, example: { method: 'GET', url: 'https://cloud.iexapis.com/stable/stock/aapl/quote?token={{apiKey}}', body: G, note: 'Free tier at iexcloud.io.' } },
  { id: 'openfigi', name: 'OpenFIGI', description: 'Map tickers to FIGI identifiers and back.', category: 'finance', auth: 'none', cors: true, example: { method: 'POST', url: 'https://api.openfigi.com/v3/mapping', headers: [['Content-Type', 'application/json']], body: json('{\n  "jobs": [{ "idType": "TICKER", "id": "AAPL" }]\n}') } },

  /* ——— Crypto ——— */
  { id: 'coingecko', name: 'CoinGecko', description: 'Prices, market caps and trending coins for 15,000+ assets.', category: 'crypto', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', body: G } },
  { id: 'coincap', name: 'CoinCap', description: 'Real-time crypto prices and market data with WebSocket support.', category: 'crypto', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.coincap.io/v2/assets/bitcoin', body: G } },
  { id: 'blockchain-info', name: 'Blockchain.info', description: 'Bitcoin prices, blocks and network statistics.', category: 'crypto', auth: 'none', cors: true, example: { method: 'GET', url: 'https://blockchain.info/ticker', body: G } },
  { id: 'kraken', name: 'Kraken', description: 'Ticker data and order books from the Kraken exchange.', category: 'crypto', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD', body: G } },
  { id: 'blockfrost', name: 'Blockfrost', description: 'Cardano blockchain data — balances, transactions, metadata.', category: 'crypto', auth: 'key', cors: true, example: { method: 'GET', url: 'https://cardano-mainnet.blockfrost.io/api/v0/network', headers: [['project_id', '{{apiKey}}']], body: G, note: 'Free key at blockfrost.io.' } },
  { id: 'cryptopanic', name: 'CryptoPanic', description: 'Crypto news aggregator with sentiment scores.', category: 'crypto', auth: 'key', cors: true, example: { method: 'GET', url: 'https://cryptopanic.com/api/v1/posts/?auth_token={{apiKey}}&public=true', body: G, note: 'Free token at cryptopanic.com.' } },

  /* ——— Games ——— */
  { id: 'opentdb', name: 'Open Trivia DB', description: 'Thousands of trivia questions with categories and difficulties.', category: 'games', auth: 'none', cors: true, example: { method: 'GET', url: 'https://opentdb.com/api.php?amount=5', body: G } },
  { id: 'freetogame', name: 'FreeToGame', description: 'Free-to-play game listings with screenshots and system requirements.', category: 'games', auth: 'none', cors: true, example: { method: 'GET', url: 'https://www.freetogame.com/api/games', body: G } },
  { id: 'chess', name: 'Chess.com Pub', description: 'Player profiles, ratings and games from Chess.com.', category: 'games', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.chess.com/pub/player/magnuscarlsen', body: G } },
  { id: 'boardgame', name: 'Board Game Geek', description: 'Board game rankings, ratings and descriptions (XML).', category: 'games', auth: 'none', cors: true, example: { method: 'GET', url: 'https://boardgamegeek.com/xmlapi2/thing?id=174430', body: G } },
  { id: 'valorant', name: 'Valorant (dafree)', description: 'Valorant skin, agent and map data for fans.', category: 'games', auth: 'none', cors: true, example: { method: 'GET', url: 'https://valorant-api.com/v1/agents?isPlayableCharacter=true', body: G } },
  { id: 'minecraft', name: 'Minecraft Server Status', description: 'Check the status and player count of any Minecraft server.', category: 'games', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.mcsrvstat.us/3/mc.hypixel.net', body: G } },
  { id: 'dnd5e', name: 'D&D 5e API', description: 'Rules, spells, monsters and items from Dungeons & Dragons.', category: 'games', auth: 'none', cors: true, example: { method: 'GET', url: 'https://www.dnd5eapi.co/api/spells/fireball', body: G } },

  /* ——— Geography ——— */
  { id: 'nominatim', name: 'OpenStreetMap Nominatim', description: 'Geocoding and reverse geocoding from OpenStreetMap.', category: 'geo', auth: 'none', cors: true, example: { method: 'GET', url: 'https://nominatim.openstreetmap.org/search?q=Berlin&format=json&limit=3', body: G, note: 'Please include a descriptive User-Agent per their usage policy.' } },
  { id: 'ip-api', name: 'ip-api', description: 'IP geolocation — free for non-commercial use.', category: 'geo', auth: 'none', cors: true, example: { method: 'GET', url: 'http://ip-api.com/json/', body: G } },
  { id: 'geocoding', name: 'Open-Meteo Geocoding', description: 'Search city names and get coordinates — no key.', category: 'geo', auth: 'none', cors: true, example: { method: 'GET', url: 'https://geocoding-api.open-meteo.com/v1/search?name=Berlin&count=3', body: G } },
  { id: 'countrylayer', name: 'CountryLayer', description: 'Country data with currencies, languages and calling codes.', category: 'geo', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.countrylayer.com/v2/name/germany?access_key={{apiKey}}', body: G, note: 'Free key at countrylayer.com.' } },
  { id: 'zippopotam', name: 'Zippopotam', description: 'Postal code → location lookup for many countries.', category: 'geo', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.zippopotam.us/us/90210', body: G } },
  { id: 'timezonedb', name: 'TimeZoneDB', description: 'Time zones, offsets and DST data for any location.', category: 'geo', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.timezonedb.com/v2.1/get-time-zone?key={{apiKey}}&format=json&by=zone&zone=Europe/Berlin', body: G, note: 'Free key at timezonedb.com.' } },
  { id: 'openstreetmap', name: 'Overpass API', description: 'Query OpenStreetMap data with a SQL-like language.', category: 'geo', auth: 'none', cors: true, example: { method: 'POST', url: 'https://overpass-api.de/api/interpreter', headers: [['Content-Type', 'application/x-www-form-urlencoded']], body: { type: 'form', content: '', form: [['data', 'node["amenity"="cafe"](52.50,13.40,52.53,13.43);out 5;']], gqlVariables: '' }, note: 'Heavy queries are rate-limited — keep them small.' } },

  /* ——— Sports ——— */
  { id: 'mlb', name: 'MLB Stats API', description: 'Official MLB stats, teams, players and schedules.', category: 'sports', auth: 'none', cors: true, example: { method: 'GET', url: 'https://statsapi.mlb.com/api/v1/teams?sportId=1', body: G } },
  { id: 'balldontlie', name: 'balldontlie', description: 'NBA player and game statistics, free.', category: 'sports', auth: 'none', cors: true, example: { method: 'GET', url: 'https://www.balldontlie.io/api/v1/players?search=jordan&per_page=3', body: G } },
  { id: 'football-data', name: 'football-data.org', description: 'Football (soccer) fixtures, tables and results.', category: 'sports', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.football-data.org/v4/matches', headers: [['X-Auth-Token', '{{apiKey}}']], body: G, note: 'Free tier at football-data.org.' } },
  { id: 'thesportsdb', name: 'TheSportsDB', description: 'Sports teams, players, events and scores.', category: 'sports', auth: 'key', cors: true, example: { method: 'GET', url: 'https://www.thesportsdb.com/api/v1/json/{{apiKey}}/searchteams.php?t=arsenal', body: G, note: 'Free demo key: 3 (use as the variable value) — or register at thesportsdb.com.' } },
  { id: 'cricapi', name: 'CricAPI', description: 'Cricket scores, standings and player data.', category: 'sports', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.cricapi.com/v1/currentMatches?apikey={{apiKey}}', body: G, note: 'Free key at cricapi.com.' } },

  /* ——— Books ——— */
  { id: 'openlibrary', name: 'Open Library', description: 'Book metadata, covers and lending info for millions of works.', category: 'books', auth: 'none', cors: true, example: { method: 'GET', url: 'https://openlibrary.org/api/books?bibkeys=ISBN:0451526538&format=json&jscmd=data', body: G } },
  { id: 'googlebooks', name: 'Google Books', description: 'Search the Google Books catalog — no key required.', category: 'books', auth: 'none', cors: true, example: { method: 'GET', url: 'https://www.googleapis.com/books/v1/volumes?q=harry+potter&maxResults=3', body: G } },
  { id: 'poetrydb', name: 'PoetryDB', description: 'The complete works of hundreds of poets, searchable.', category: 'books', auth: 'none', cors: true, example: { method: 'GET', url: 'https://poetrydb.org/title/Ozymandias/lines.json', body: G } },
  { id: 'bible', name: 'Bible API', description: 'Bible passages in multiple translations.', category: 'books', auth: 'none', cors: true, example: { method: 'GET', url: 'https://bible-api.com/john+3:16', body: G } },
  { id: 'liturgia', name: 'Liturgia', description: 'Catholic liturgical calendar data (Latin).', category: 'books', auth: 'none', cors: true, example: { method: 'GET', url: 'https://liturgia.sjvavrille.fr/api/1.0/calendar/today', body: G } },
  { id: 'newscatcher', name: 'Newscatcher', description: 'Searchable news archive focused on US sources.', category: 'books', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.newscatcherapi.com/v2/search?q=technology', headers: [['x-api-key', '{{apiKey}}']], body: G, note: 'Free tier at newscatcherapi.com.' } },

  /* ——— Images ——— */
  { id: 'picsum', name: 'Lorem Picsum', description: 'Random placeholder photos from Unsplash.', category: 'images', auth: 'none', cors: true, example: { method: 'GET', url: 'https://picsum.photos/id/237/400/300', body: G, note: 'Returns an image directly.' } },
  { id: 'dogceo', name: 'Dog CEO', description: 'Random dog pictures by breed.', category: 'images', auth: 'none', cors: true, example: { method: 'GET', url: 'https://dog.ceo/api/breeds/image/random', body: G } },
  { id: 'robohash', name: 'RoboHash', description: 'Unique robot avatars from any text.', category: 'images', auth: 'none', cors: true, example: { method: 'GET', url: 'https://robohash.org/loadix.png', body: G, note: 'Returns a PNG image.' } },
  { id: 'thecatapi', name: 'TheCatAPI', description: 'Cat images and breeds (yes, you need a key).', category: 'images', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.thecatapi.com/v1/images/search?limit=1', headers: [['x-api-key', '{{apiKey}}']], body: G, note: 'Free key at thecatapi.com.' } },
  { id: 'unsplash', name: 'Unsplash', description: 'High-quality stock photography via official API.', category: 'images', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.unsplash.com/photos/random', headers: [['Authorization', 'Client-ID {{apiKey}}']], body: G, note: 'Free key at unsplash.com/developers.' } },
  { id: 'dicebear', name: 'DiceBear', description: 'Avatar generation in 20+ styles from a seed string.', category: 'images', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.dicebear.com/9.x/avataaars/svg?seed=loadix', body: G, note: 'Returns an SVG.' } },

  /* ——— Science & Space ——— */
  { id: 'iss', name: 'Open Notify (ISS)', description: 'Live position of the International Space Station.', category: 'science', auth: 'none', cors: true, example: { method: 'GET', url: 'http://api.open-notify.org/iss-now.json', body: G } },
  { id: 'spacex', name: 'SpaceX Data API', description: 'Launches, rockets, capsules and Starlink data.', category: 'science', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.spacexdata.com/v4/launches/latest', body: G } },
  { id: 'numbersapi', name: 'Numbers API', description: 'Interesting facts about any number.', category: 'science', auth: 'none', cors: true, example: { method: 'GET', url: 'http://numbersapi.com/42/trivia', body: G } },
  { id: 'agify', name: 'Agify', description: 'Predict age from a first name.', category: 'science', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.agify.io/?name=peter', body: G } },
  { id: 'genderize', name: 'Genderize', description: 'Predict gender from a first name.', category: 'science', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.genderize.io/?name=peter', body: G } },
  { id: 'nationalize', name: 'Nationalize', description: 'Predict nationality from a first name.', category: 'science', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.nationalize.io/?name=nathaniel', body: G } },
  { id: 'openfda', name: 'OpenFDA', description: 'US drug approvals, adverse events and recalls.', category: 'science', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.fda.gov/drug/event.json?limit=3', body: G } },
  { id: 'n2yo', name: 'N2YO', description: 'Satellite tracking and passes over your location.', category: 'science', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.n2yo.com/rest/v1/satellite/25544/positions/52.52/13.41/3/&apiKey={{apiKey}}', body: G, note: 'Free key at n2yo.com.' } },

  /* ——— Travel & Transit ——— */
  { id: 'tfl', name: 'Transport for London', description: 'Tube, bus and rail status for London.', category: 'travel', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.tfl.gov.uk/Line/Mode/tube/Status', body: G } },
  { id: 'komoot', name: 'komoot', description: 'Elevation profiles for hiking and biking routes.', category: 'travel', auth: 'none', cors: true, example: { method: 'GET', url: 'https://photon.komoot.io/api/?q=paris&limit=3', body: G } },
  { id: 'seatgeek', name: 'SeatGeek', description: 'Concert and event listings with venue details.', category: 'travel', auth: 'key', cors: true, example: { method: 'GET', url: 'https://api.seatgeek.com/2/events?client_id={{apiKey}}', body: G, note: 'Free client id at seatgeek.com (it works without a secret for low volume).' } },
  { id: 'amadeus', name: 'Amadeus', description: 'Flight offers, airport info and travel analytics.', category: 'travel', auth: 'bearer', cors: true, example: { method: 'GET', url: 'https://api.amadeus.com/v1/reference-data/locations?keyword=PAR&subType=AIRPORT', body: G, note: 'Get a token: POST /v1/security/oauth2/token with your API key/secret.' } },
  { id: 'openrail', name: 'Open Railway Map', description: 'Public transport departure boards and station data.', category: 'travel', auth: 'none', cors: true, example: { method: 'GET', url: 'https://v5.vbb.transport.rest/stops/900000003201/departures?results=5', body: G } },

  /* ——— Health ——— */
  { id: 'openfda-drug', name: 'OpenFDA (drugs)', description: 'Drug labeling and adverse event reports (US).', category: 'health', auth: 'none', cors: true, example: { method: 'GET', url: 'https://api.fda.gov/drug/label.json?search=aspirin&limit=2', body: G } },
  { id: 'covid', name: 'disease.sh', description: 'COVID-19 and disease statistics from Johns Hopkins data.', category: 'health', auth: 'none', cors: true, example: { method: 'GET', url: 'https://disease.sh/v3/covid-19/all', body: G } },
  { id: 'nutritionix', name: 'Nutritionix', description: 'Nutrition facts for food items and restaurant meals.', category: 'health', auth: 'key', cors: true, example: { method: 'GET', url: 'https://trackapi.nutritionix.com/v2/search/instant?query=apple', headers: [['x-app-id', '{{apiKey}}'], ['x-app-key', '{{apiKey2}}']], body: G, note: 'Free tier at nutritionix.com — needs app id AND app key (use variables apiKey / apiKey2).' } },
];

/** Map of id → entry for O(1) lookups. */
export const API_DIRECTORY_BY_ID: ReadonlyMap<string, DirectoryApi> = new Map(API_DIRECTORY.map((a) => [a.id, a]));

export const API_DIRECTORY_CATEGORY_BY_ID: ReadonlyMap<string, DirectoryCategory> = new Map(DIRECTORY_CATEGORIES.map((c) => [c.id, c]));