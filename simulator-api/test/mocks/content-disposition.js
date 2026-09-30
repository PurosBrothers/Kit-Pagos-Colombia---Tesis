function create(filename, options) {
  const type = (options && options.type) || 'attachment';
  if (!filename) return type;
  return `${type}; filename="${filename}"`;
}

function parse(header, options) {
  return { type: 'attachment', parameters: {} };
}

module.exports = {
  create,
  parse,
  default: { create, parse },
};
