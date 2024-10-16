// Main Source: https://www.apollographql.com/docs/apollo-server/data/subscriptions#basic-runnable-example
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import express from "express";
import { createServer } from "http";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import { PubSub } from "graphql-subscriptions";
import bodyParser from "body-parser";
import cors from "cors";
import {
  ApolloServerPluginLandingPageLocalDefault,
  ApolloServerPluginLandingPageProductionDefault,
} from "@apollo/server/plugin/landingPage/default";

const PORT = 4000;
const pubsub = new PubSub();

const objects = [
  {
    id: "1",
    name: "Object 1",
    type: "a",
    valid_from: "2024-01-01T00:00:00Z",
    valid_to: "2024-12-31T23:59:59Z",
  },
  {
    id: "2",
    name: "Object 2",
    type: "a",
    valid_from: "2023-05-01T00:00:00Z",
    valid_to: "2024-12-31T23:59:59Z",
  },
  {
    id: "3",
    name: "Object 3",
    type: "b",
    valid_from: "2022-01-01T00:00:00Z",
    valid_to: "2023-12-31T23:59:59Z",
  },
];

// A number that we'll increment over time to simulate subscription events
let currentNumber = 0;

// Schema definition
const typeDefs = `#graphql
  scalar DateTime
  type Object {
    id: ID!
    name: String!
    valid_from: DateTime!
    valid_to: DateTime
    type: String!
  }
  
  type Query {
    currentNumber: Int
    objects(isValid: Boolean, nameIncludes: String): [Object]
    orObjects(where: ObjectWhereInput): [Object]
    dynamicObjects(where: DynamicFilterInput): [Object]
  }

  input DynamicFilterInput {
    field: String!
    value: String!
    operator: String
  }

  input ObjectWhereInput {
    OR: [ObjectFilterInput]
  }

  input ObjectFilterInput {
    nameContains: String
    type: String
  }

  type Subscription {
    numberIncremented: Int
  }
`;

// Resolver map
const resolvers = {
  Query: {
    currentNumber() {
      return currentNumber;
    },
    objects(_, { isValid, nameIncludes }) {
      const currentDate = new Date().toISOString();

      let filteredObj = objects;

      if (isValid) {
        filteredObj = objects.filter((obj) => {
          return (
            obj.valid_from <= currentDate &&
            (obj.valid_to >= currentDate || !obj.valid_to)
          );
        });
      }

      if (nameIncludes) {
        filteredObj = objects.filter((obj) => {
          return obj.name.includes(nameIncludes);
        });
      }

      return filteredObj;
    },
    orObjects(_, { where }) {
      let filteredObj = objects;
      if (where && where.OR) {
        filteredObj = objects.filter((obj) => {
          return where.OR.some((filter) => {
            const validName =
              filter.nameContains && obj.name.includes(filter.nameContains);
            const validType = filter.type && obj.type === filter.type;

            return validName || validType;
          });
        });
      }

      return filteredObj;
    },
    dynamicObjects: (_, { where }) => {
      const { field, value, operator } = where;

      return objects.filter((obj) => {
        const fieldValue = obj[field]; // Dynamically access the field

        // Handle different operators (equals, contains, etc.)
        switch (operator) {
          case "contains":
            return fieldValue.toLowerCase().includes(value.toLowerCase());
          case "equals":
          default:
            return fieldValue === value;
        }
      });
    },
  },
  Subscription: {
    numberIncremented: {
      subscribe: () => pubsub.asyncIterator(["NUMBER_INCREMENTED"]),
    },
  },
};

// Create schema, which will be used separately by ApolloServer and
// the WebSocket server.
const schema = makeExecutableSchema({ typeDefs, resolvers });

// Create an Express app and HTTP server; we will attach the WebSocket
// server and the ApolloServer to this HTTP server.
const app = express();
const httpServer = createServer(app);

// Set up WebSocket server.
const wsServer = new WebSocketServer({
  server: httpServer,
  path: "/graphql",
});

wsServer.on("connection", (socket) => {
  console.log("WebSocket connection established");
  socket.on("message", (message) => {});
});

wsServer.on("close", () => {
  console.log("WebSocket connection closed");
});

wsServer.on("error", (error) => {
  console.error("WebSocket error:", error);
});

const serverCleanup = useServer({ schema }, wsServer);

// Set up ApolloServer.
const server = new ApolloServer({
  schema,
  plugins: [
    // Proper shutdown for the HTTP server.
    ApolloServerPluginDrainHttpServer({ httpServer }),

    // Proper shutdown for the WebSocket server.
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
          },
        };
      },
    },
    process.env.NODE_ENV === "production"
      ? ApolloServerPluginLandingPageProductionDefault()
      : ApolloServerPluginLandingPageLocalDefault({
          footer: false,
          embed: {
            endpointIsEditable: true,
          },
        }),
  ],
});

await server.start();
app.use("/graphql", cors(), bodyParser.json(), expressMiddleware(server));

// Now that our HTTP server is fully set up, actually listen.
httpServer.listen(PORT, () => {
  console.log(`🚀 Query endpoint ready at http://localhost:${PORT}/graphql`);
  console.log(
    `🚀 Subscription endpoint ready at ws://localhost:${PORT}/graphql`
  );
});

// In the background, increment a number every second and notify subscribers when it changes.
function incrementNumber() {
  currentNumber++;
  pubsub.publish("NUMBER_INCREMENTED", { numberIncremented: currentNumber });
  console.log("Number incremented:", currentNumber);
  setTimeout(incrementNumber, 2000);
}

// Start incrementing
incrementNumber();
