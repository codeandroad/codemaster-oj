const pythonImportSource='Independent CodeMaster exercise; curriculum reference: https://www.hackerrank.com/challenges/';
const pythonImportNotesPrefix='\n\n## Notes\n\nThis is an independently authored CodeMaster exercise corresponding to a curriculum topic, not a reproduction of the linked HackerRank challenge. Method suggestions are learning guidance; grading checks observable results. Python 3.12 ';
const pythonImportNotes=[
 'and its standard library is available.',
 'with NumPy 2.2.6 is available.',
].map(runtime=>pythonImportNotesPrefix+runtime);

// Keep the immutable source and reviewed source hashes intact. Only the two
// generated footers from the old Python import are omitted from presentation.
export function legacyProblemStatement({statement,source}){
 if(!source?.startsWith(pythonImportSource))return statement;
 const notes=pythonImportNotes.find(footer=>statement.endsWith(footer));
 return notes?statement.slice(0,-notes.length):statement;
}
