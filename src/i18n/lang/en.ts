import type { UIStrings } from "../types";

export default {
  nav: {
    home: "Home",
    posts: "Posts",
    tags: "Tags",
    about: "About",
    archives: "Archives",
    search: "Search",
  },
  post: {
    publishedAt: "Published at",
    updatedAt: "Updated",
    sharePostIntro: "Share this post:",
    sharePostOn: "Share this post on {{platform}}",
    sharePostViaEmail: "Share this post via email",
    tagLabel: "Tags",
    backToTop: "Back to top",
    goBack: "Go back",
    editPage: "Edit page",
    previousPost: "Previous Post",
    nextPost: "Next Post",
    minRead: "{{count}} min read",
    part: "Part {{n}}",
    onThisPage: "On this page",
  },
  pagination: {
    prev: "Prev",
    next: "Next",
    page: "Page",
  },
  home: {
    socialLinks: "Social Links",
    featured: "Featured",
    recentPosts: "Recent Posts",
    allPosts: "All Posts",
    intro:
      "Posts come in four kinds: series parts read in order, concepts explain one idea, field notes tell one thing that went wrong, methods show how we measure.",
    series: "Series",
    latest: "Latest",
    partCount: "{{count}} part",
    partsCount: "{{count}} parts",
  },
  series: {
    label: "Series",
    partOf: "Part {{n}} of {{total}}",
    partPublished: "Part {{n}}, {{count}} published so far",
    previous: "Previous in series",
    next: "Next in series",
  },
  footer: {
    copyright: "Copyright",
    allRightsReserved: "All rights reserved.",
    sourceNote: "Each post is written from the project repo it links to.",
    rss: "RSS",
    navLabel: "Footer",
  },
  kinds: {
    series: "Series",
    concept: "Concept",
    fieldnote: "Field note",
    method: "Method",
  },
  kindsPlural: {
    series: "Series",
    concept: "Concepts",
    fieldnote: "Field notes",
    method: "Methods",
  },
  pages: {
    tagTitle: "Tag",
    tagDesc: "All the articles with the tag",

    tagsTitle: "Tags",
    tagsDesc: "All the tags used in posts.",

    postsTitle: "Posts",
    postsDesc: "All the articles I've posted.",

    archivesTitle: "Archives",
    archivesDesc: "All the articles I've archived.",

    searchTitle: "Search",
    searchDesc: "Search any article ...",
  },
  a11y: {
    skipToContent: "Skip to content",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    toggleTheme: "Toggle theme",
    searchPlaceholder: "Search posts...",
    noResults: "No results found",
    goToPreviousPage: "Go to previous page",
    goToNextPage: "Go to next page",
  },
  notFound: {
    title: "404 Not Found",
    message: "Page Not Found",
    goHome: "Go back home",
  },
} satisfies UIStrings;
