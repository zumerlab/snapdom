/**
 * myPlugin - SnapDOM Plugin
 * Description of what your plugin does.
 *
 * @param {Object} [options]
 * @param {string} [options.example='default'] - Describe this option
 * @returns {Object} SnapDOM plugin
 */
export function myPlugin(options = {}) {
  const {
    example = 'default',
  } = options;

  return {
    name: 'my-plugin',

    // Pick the hook(s) you need. Delete the rest.
    // Full lifecycle: beforeSnap → beforeClone → afterClone → beforeRender → afterRender →
    // [per export: beforeExport → afterExport] → afterSnap. Plus resolveNode(node, ctx) per element
    // during the clone walk, and defineExports() for custom output formats.
    // Clone-phase hooks read options from ctx.options; export-phase hooks get them flattened on ctx.

    // beforeSnap(ctx) {
    //   // Runs before anything happens. ctx.element is the original DOM node.
    // },

    // beforeClone(ctx) {
    //   // Runs before the element is cloned. Good for pre-processing the source.
    // },

    afterClone(ctx) {
      // Runs after cloning + style inlining. ctx.clone is the cloned DOM tree.
      // This is the most common hook: modify the clone here.
      // To hand data to a custom export, write it to ctx.options as well:
      //   ctx.options.__myData = data
    },

    // beforeRender(ctx) {
    //   // Runs before the clone is serialized into SVG.
    // },

    // afterRender(ctx) {
    //   // Runs after rendering. ctx.svgString is the SVG text, ctx.dataURL the encoded URL.
    // },

    // beforeExport(ctx, { format, options }) {
    //   // Runs before each export call. Adjust `options` for this export.
    // },

    // afterExport(ctx, { format, options, result }) {
    //   // Runs after each export. Observation only: returning a value does not
    //   // replace what the caller receives. Use afterSnap(ctx) for one-time cleanup.
    // },

    // defineExports() {
    //   // Return an object of custom export methods.
    //   // They become available as result.toMyFormat() and result.to('myFormat')
    //   return {
    //     myFormat: async (ctx, opts = {}) => {
    //       // ctx.export.url has the data URL
    //       return 'custom output';
    //     }
    //   };
    // },
  };
}

export default myPlugin;
