export function greet(name: string): string {
  return `hi ${name}`;
}

// An in-app caller: this call IS part of the application call graph.
export function welcome(): string {
  return greet("world");
}
