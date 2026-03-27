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
    // Full lifecycle: beforeSnap → beforeClone → afterClone → beforeRender → afterRender → beforeExport → afterExport

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
    //   // Runs after rendering. ctx.svg is the SVG string.
    // },

    // beforeExport(ctx) {
    //   // Runs before export methods are called.
    // },

    // afterExport(ctx) {
    //   // Runs after export. Good for cleanup.
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
