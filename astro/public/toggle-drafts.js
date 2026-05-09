document.addEventListener("DOMContentLoaded", () => {
  const toggleButton = document.getElementById("toggle-drafts");
  const draftPosts = document.querySelectorAll(".draft-post");
  let showingDrafts = false;

  if (!toggleButton) return;

  toggleButton.addEventListener("click", () => {
    showingDrafts = !showingDrafts;
    for (const post of draftPosts) {
      if (showingDrafts) {
        post.style.display = "block";
      } else {
        post.style.display = "none";
      }
    }
    if (showingDrafts) {
      toggleButton.textContent = "✓ Showing Drafts";
      toggleButton.className =
        "px-4 py-2 text-sm font-medium rounded-lg border transition-colors bg-yellow-900/50 text-yellow-300 border-yellow-700 hover:bg-yellow-900/70 min-w-[140px]";
    } else {
      toggleButton.textContent = "Show Drafts";
      toggleButton.className =
        "px-4 py-2 text-sm font-medium rounded-lg border transition-colors bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 min-w-[140px]";
    }
  });
});
