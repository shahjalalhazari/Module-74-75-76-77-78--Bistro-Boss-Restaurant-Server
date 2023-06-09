const express = require('express');
const cors = require('cors');
require("dotenv").config();
const jwt = require('jsonwebtoken');

const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: "unauthorized access" });
    };
    // Split the authorization header and get only the token.
    const token = authorization.split(" ")[1];

    // verify the token
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: "unauthorized access" });
        };
        req.decoded = decoded;
        next();
    });
};


app.get("/", (req, res) => {
    res.send("Bistro Boss server is running");
});


//////////// MongoDb Connection Start //////////////
const {
    MongoClient,
    ServerApiVersion,
    ObjectId
} = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.cp5mulo.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        /////////// All Collections /////////////
        const userCollection = client.db("BistroBossDb").collection("users");
        const menuCollection = client.db("BistroBossDb").collection("menu");
        const reviewCollection = client.db("BistroBossDb").collection("reviews");
        const cartCollection = client.db("BistroBossDb").collection("carts");
        const paymentCollection = client.db("BistroBossDb").collection("payments");


        ////////// JWT TOKEN API ///////////
        app.post("/jwt", (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {expiresIn: "1h"});
            res.send(token);
        });

        // Verify user is admin or not
        // warning: use verifyJWT before using verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = {email: email};
            const user = await userCollection.findOne(query);
            if (user?.role !== "admin") {
                return res.status(403).send({error: true, message: "forbidden message"})
            };
            next();
        };


        ////////  Users APIs ///////////////
        // get all the users
        app.get("/users", async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        // add new user after signup
        app.post("/users", async (req, res) => {
            const user = req.body;
            const query = {email: user.email};
            // check if the user is exists or not for social login
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({message: "User Already Exists."})
            };
            const result = await userCollection.insertOne(user);
            res.send(result);
        });


        // get is user admin or not
        app.get("/users/admin/:email", verifyJWT, async (req, res) => {
            const email = req.params.email;

            // verify with JWT
            if (req.decoded.email !== email) {
                res.send({admin: false});
            };

            const query = {email: email};
            const user = await userCollection.findOne(query);
            const result = {admin: user?.role === "admin"};
            res.send(result);
        });


        // update user role
        app.patch("/users/admin/:id", async (req, res) => {
            const id = req.params.id; //Get the user id
            const filter = {_id: new ObjectId(id)}; // Filter the user by id
            const updateDoc = { // set which thing want to update
                $set: {
                    role: "admin"
                }
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result)
        });


        /////////// Menu APIs //////////////
        // get all menu items
        app.get("/menu", async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        });


        // add or post new menu item
        app.post("/menu", verifyJWT, verifyAdmin, async (req, res) => {
            const newItem = req.body;
            const result = await menuCollection.insertOne(newItem);
            res.send(result);
        });

        // delete menu item
        app.delete("/menu/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = {_id: new ObjectId(id)};
            const result = await menuCollection.deleteOne(query);
            res.send(result)
        });


        ////////// Reviews APIs //////////////
        // get all reviews
        app.get("/reviews", async (req, res) => {
            const result = await reviewCollection.find().toArray();
            res.send(result);
        });


        /////////// Cart APIs ////////////
        // get all the cart item of current user
        app.get("/carts", verifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([])
            };

            const decodedEmail = req.decoded.email;

            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: "Forbidden Access" });
            };
            const query = {email: email};
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });

        // add item to cart of current user
        app.post("/carts", async (req, res) => {
            const item = req.body;
            const result = await cartCollection.insertOne(item);
            res.send(result);
        });

        // delete item from current user cart
        app.delete("/carts/:id", async (req, res) => {
            const id = req.params.id;
            console.log(id);
            const query = {_id: new ObjectId(id)};
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });


        /////////// Payment APIs ////////////
        // create payment intent
        app.post("/create-payment-intent", verifyJWT, async (req, res) => {
            const {price} = req.body;
            const amount = Math.round(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });


        // app completed payment details
        app.post("/payments", verifyJWT, async (req, res) => {
            const payment = req.body;
            const InsertResult = await paymentCollection.insertOne(payment);

            // delete cart items after payment completed
            const query = {_id: { $in: payment.cartItems.map(id => new ObjectId(id))}};
            const deleteResult = await cartCollection.deleteMany(query);

            res.send({InsertResult, deleteResult});
        });

        ////////////// api for admin ///////////
        app.get("/admin-stats", verifyJWT, verifyAdmin, async (req, res) => {
            // count all the user as customers
            const customers = await userCollection.estimatedDocumentCount();
            // count all the menu items as products
            const products = await menuCollection.estimatedDocumentCount();
            // count all the payments as orders
            const orders = await paymentCollection.estimatedDocumentCount();
            // add all the payment price together to get the revenue
            const payments = await paymentCollection.find().toArray();
            const revenue = payments.reduce((sum, payment) => sum + payment.price, 0);
    
            res.send({
                customers, products, orders, revenue
            })
        })
        

        // Send a ping to confirm a successful connection
        await client.db("admin").command({
            ping: 1
        });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // await client.close();
    };
}
run().catch(console.dir);



app.listen(port, () => {
    console.log(`Bistro Boss server is running on ${port}`)
});