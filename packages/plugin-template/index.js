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
    // Full lifecycle: beforeSnap → beforeClone → resolveNode → afterClone → beforeRender → afterRender
    // → defineExports → [beforeExport → exporter → afterExport] → afterSnap

    // beforeSnap(ctx) {
    //   // Runs before anything happens. ctx.element is the original DOM node.
    // },

    // beforeClone(ctx) {
    //   // Runs before the element is cloned. Good for pre-processing the source.
    // },

    afterClone(ctx) {
      // Runs after cloning + style inlining. ctx.clone is the cloned DOM tree.
      // This is the most common hook — modify the clone here.
    },

    // beforeRender(ctx) {
    //   // Runs before the clone is serialized into SVG.
    // },

    // afterRender(ctx) {
    //   // Runs after rendering. ctx.svgString is the SVG source; ctx.meta is the geometry.
    // },

    // beforeExport(ctx, { format, options }) {
    //   // Change options to steer this export. Hook return values are ignored.
    // },

    // afterExport(ctx, { format, options, result }) {
    //   // Observes each export result. Hook return values are ignored.
    // },

    // defineExports() {
    //   // Return an object of custom export methods.
    //   // They become available as result.toMyFormat()
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
