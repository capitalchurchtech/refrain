import { initSetup } from "./setup.js";
import { initSearch } from "./search.js";
import { initHealth } from "./health.js";

const viewSetup = document.getElementById("view-setup");
const viewApp = document.getElementById("view-app");
const viewSearch = document.getElementById("view-search");
const viewHealth = document.getElementById("view-health");
const tabSearch = document.getElementById("tab-search");
const tabHealth = document.getElementById("tab-health");

async function boot() {
  const { needsSetup } = await fetch("/api/setup/status").then((r) => r.json());

  if (needsSetup) {
    viewSetup.classList.remove("hidden");
    initSetup({
      onComplete: () => {
        viewSetup.classList.add("hidden");
        startApp();
      },
    });
  } else {
    startApp();
  }

  if (window.lucide) window.lucide.createIcons();
}

function startApp() {
  viewApp.classList.remove("hidden");
  initSearch();
  const health = initHealth();

  tabSearch.addEventListener("click", () => showTab("search"));
  tabHealth.addEventListener("click", () => {
    showTab("health");
    health.render();
  });
}

function showTab(name) {
  const isSearch = name === "search";
  viewSearch.classList.toggle("hidden", !isSearch);
  viewHealth.classList.toggle("hidden", isSearch);
  tabSearch.classList.toggle("tab-active", isSearch);
  tabHealth.classList.toggle("tab-active", !isSearch);
}

boot();
