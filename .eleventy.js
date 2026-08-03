export default function (eleventyConfig) {
  eleventyConfig.setInputDirectory("src");
  eleventyConfig.setOutputDirectory("_site");
  eleventyConfig.setIncludesDirectory("_includes");
  eleventyConfig.setDataDirectory("_data");

  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

  eleventyConfig.addWatchTarget("lib/");
  eleventyConfig.addWatchTarget("src/assets/");

  eleventyConfig.setServerOptions({ port: 8080, showAllHosts: false });

  eleventyConfig.addFilter("money", (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return "$" + Math.round(n).toLocaleString("en-US");
  });

  eleventyConfig.addFilter("pct", (v, places = 2) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return (n * 100).toFixed(places) + "%";
  });

  return {
    templateFormats: ["njk", "md", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
