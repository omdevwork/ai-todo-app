import db from './db/index.js';
import { todosTable } from './db/schema.js';
import { ilike, eq } from 'drizzle-orm';
import readlineSync from "readline-sync";

import OpenAI from "openai";
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

async function getAllTodos() {
    const todos = await db.select().from(todosTable);
    return todos;
}

async function createTodo(todo) {
    const [result] = await db.insert(todosTable).values({ todo }).returning({
        id: todosTable.id,
    });
    return result.id;
}

async function updateTodoByContent(content, newContent) {
    const { data, error } = await supabase
        .from('todos')
        .select('*')
        .ilike('description', `%${content}%`);
    if (error || !data?.length) {
        throw new Error('No todo found with matching content');
    }
    const todo = data[0];
    const { error: updateError } = await supabase
        .from('todos')
        .update({ description: newContent })
        .eq('id', todo.id);
    if (updateError) {
        throw new Error('Failed to update todo');
    }
    return { message: `Todo updated from "${content}" to "${newContent}"` };
}

async function deleteTodoById(id) {
    await db.delete(todosTable).where(eq(todosTable.id, id));
}

async function searchTodos(search) {
    const todos = await db
        .select()
        .from(todosTable)
        .where(ilike(todosTable.todo, `%${search}%`));
    return todos;
}

const tools = {
    getAllTodos: getAllTodos,
    createTodo: createTodo,
    deleteTodoById: deleteTodoById,
    updateTodoByContent: updateTodoByContent,
    searchTodos: searchTodos
}

const SYSTEM_PROMPT = `
You are an AI To-Do List Assistant with START, PLAN, ACTION, Observation and Output State.
Wait for the user prompt and first PLAN using available tools.
After planning, Take the action with appropriate tools and wait for Observation based on Action.
Once you get the Observation, Return the AI response based on START prompt and Observations.

You can manage tasks by adding, viewing, updating, deleting, and searching them.
You must strictly follow the JSON output format.

Todo Databse Schema:
id: integer and primaryKey
todo: string and notNull
created_at: timestamp and defaultNow
updated_at: timestamp and $onUpdate

Available Tools:
- getAllTodos(): Returns all the todos from the Database.
- createTodo(todo: string): Creates a new todo in the Database and takes todo as a string and returns the ID of created todo.
- deleteTodoById(id: string): Deletes a todo by its ID from the Database.
- searchTodos(query: string): Searches for all todos matching the query string using ilike operator in Database.

Example:
START
{"type": "user", "user": "Add a task for shopping groceries."}
{"type": "plan", "plan": "I will try to get more context on what user needs to shop."}
{"type": "output", "output": "Can you tell me what all items you want to shop?"}
{"type": "user", "user": "I want to shop for milk, kurkure, lays and chocolates."}
{"type": "plan", "plan": "I will use createTodo to create a new todo in Databse."}
{"type": "action", "function": "createTodo", "input": "shopping for milk, kurkure, lays and chocolates"}
{"type": "observation", "observation": "2"}
{"type": "output", "output": "Your todo has been added successfully!"}

Update Example:
START
{"type": "user", "user": "Change the facebook posts to social media post"}
{"type": "plan", "plan": "I will use updateTodoByContent to find a todo containing 'facebook posts' and update it to 'social media post'."}
{"type": "action", "function": "updateTodoByContent", "input": {"oldContent": "facebook posts", "newContent": "social media post"}}
{"type": "observation", "observation": "3"}
{"type": "output", "output": "Todo updated successfully!"}
`

const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
]

while (true) {
    const query = readlineSync.question('>> ');
    const userMessage = { "type": "user", "user": query };
    messages.push({ role: 'user', content: JSON.stringify(userMessage) });

    while (true) {
        const chat = await client.chat.completions.create({
            model: 'gpt-4o',
            messages: messages,
            response_format: { type: 'json_object' }
        })
        const response = chat.choices[0].message.content
        messages.push({ role: 'assistant', content: response })

        const action = JSON.parse(response);

        if (action.type === "output") {
            console.log(`🤖: ${action.output}`);
            break;
        } else if (action.type === "action") {
            const fn = tools[action.function];
            if (!fn) throw new Error(`Function ${action.function} not found`);

            const observation = await fn(action.input);
            const observationMessage = { "type": "observation", "observation": observation }
            messages.push({ role: 'developer', content: JSON.stringify(observationMessage) });
        }
    }
}