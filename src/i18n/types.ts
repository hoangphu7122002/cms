export interface UIStrings {
  nav: {
    home: string;
    posts: string;
    tags: string;
    about: string;
    archives: string;
    search: string;
  };
  post: {
    publishedAt: string;
    updatedAt: string;
    sharePostIntro: string;
    sharePostOn: string;
    sharePostViaEmail: string;
    tagLabel: string;
    backToTop: string;
    goBack: string;
    editPage: string;
    previousPost: string;
    nextPost: string;
    minRead: string;
    part: string;
    onThisPage: string;
  };
  pagination: {
    prev: string;
    next: string;
    page: string;
  };
  home: {
    socialLinks: string;
    featured: string;
    recentPosts: string;
    allPosts: string;
    intro: string;
    series: string;
    latest: string;
    partCount: string;
    partsCount: string;
  };
  series: {
    label: string;
    partOf: string;
    partPublished: string;
    previous: string;
    next: string;
  };
  footer: {
    copyright: string;
    allRightsReserved: string;
    sourceNote: string;
    rss: string;
    navLabel: string;
  };
  kinds: {
    series: string;
    concept: string;
    fieldnote: string;
    method: string;
  };
  /** plural kind names, used as the title of a series without its own name */
  kindsPlural: {
    series: string;
    concept: string;
    fieldnote: string;
    method: string;
  };
  pages: {
    tagTitle: string;
    tagDesc: string;

    tagsTitle: string;
    tagsDesc: string;

    postsTitle: string;
    postsDesc: string;

    archivesTitle: string;
    archivesDesc: string;

    searchTitle: string;
    searchDesc: string;
  };
  a11y: {
    skipToContent: string;
    openMenu: string;
    closeMenu: string;
    toggleTheme: string;
    searchPlaceholder: string;
    noResults: string;
    goToPreviousPage: string;
    goToNextPage: string;
  };
  notFound: {
    title: string;
    message: string;
    goHome: string;
  };
}
