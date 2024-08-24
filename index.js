// database access er jonne role set korte hoy jokhon user access thik korbo database e 
// at least read and write er control dite hbe

const express = require('express')
const app = express()
const cors = require('cors')
const port = process.env.PORT || 5000
const jwt = require('jsonwebtoken');
require('dotenv').config()


app.use(cors())
app.use(express.json())


// mongodb connection
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@clusterfirst.7ajn2mv.mongodb.net/?retryWrites=true&w=majority&appName=ClusterFirst`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

//security key for payment
const stripe = require("stripe")(process.env.SECRET_KEY)
// console.log(stripe,'secret key')

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    const database = client.db('MMMRestaurantInd');

    const menus = database.collection('menu');
    const reviews = database.collection('reviews');
    const carts = database.collection('carts');
    const users = database.collection('users');
    const payments = database.collection('payments');


    //middlwWares for verification
    
    // token verify for api by jwt
    const verify = (req, res, next) => {
      // console.log('token is', req.headers.authorization)
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'there is no access' })
      }

      const token = req.headers.authorization.split(' ')[1];
      
      // invalid token
      jwt.verify(token, process.env.ACCESS_TOKEN ,  (err, decoded) => {
        if(err)
          {
            return res.status(401).send({message:"forbidden"})
          }
          req.decoded = decoded;
          // console.log('from decoded',decoded)
          next()
      });
    }

    // verify for admin

    const AdminVerify = async (req,res,next)=>{
      const decodedEmail=req.decoded.data.email;
      const query ={email : decodedEmail}
      const user = await users.findOne(query);
      if(!user?.role === 'admin'){
        return res.status(401).send({message:"forbidden"})
      }
      next();
    }

    // for get

    app.get('/menu', async (req, res) => {
      const menu = await menus.find().toArray()
      // console.log(menu)
      res.send(menu)
    })

    app.get('/menu/:id', async (req, res) => {
      const id =req.params.id;
      // console.log(id)
      const query={_id: new ObjectId(id)}
      const menu = await menus.findOne(query);  
      // console.log(menu)
      res.send(menu)
    })

    app.get('/reviews', async (req, res) => {
      const review = await reviews.find().toArray()
      // console.log(menu)
      res.send(review)
    })

    app.get('/carts',async (req, res) => {
      const email = req.query.email;
      // console.log(email)
      const query = { email: email }
      const result = await carts.find(query).toArray()
      res.send(result)
    })

    app.get('/users', verify,AdminVerify , async (req, res) => {
      const Allusers = await users.find().toArray();
      res.send(Allusers)
    })

    app.get('/users/admin/:email', verify, async (req,res)=>{
      const email = req.params.email;
      const decodedEmail = req.decoded.data.email;
      // console.log('email is',decodedEmail)
      if(email !== decodedEmail)
        {
          return res.status(403).send({message:"unauthorized"})
        }
        const query= {email :email};
        const user = await users.findOne(query);
        let admin =false;
        if(user?.role === 'admin'){
          admin = true;
        }
        
        res.send(admin)
    })

    app.get('/paymentHistory/:email',verify,async (req,res)=>{
      const email = req.params.email;
      const decodedEmail = req.decoded.data.email;
      // console.log('email is',decodedEmail)
      if(email !== decodedEmail)
        {
          return res.status(403).send({message:"unauthorized"})
        }
        const query= {email :email};
        const PaymentResult= await payments.find(query).toArray()
        res.send(PaymentResult);
    })

    app.get('/admin-stats',async(req,res)=>{
      const user= await users.estimatedDocumentCount();
      const menu= await menus.estimatedDocumentCount();
      //order ta count kortese total j koyta payments hoise tar upor
      const order= await payments.estimatedDocumentCount();

      //price calculation chaile reduce diye kora jay bt not best way 
      //there is another good option
      const result = await payments.aggregate([
        {
          $group:{
            _id: null, //eta dite hobe same as here r rename korle $project diye kora lagbe
            revenueSum: {
              $sum:'$price'
            }
          }
        }
      ]).toArray();
      const revenue = result.length>0?result[0].revenueSum:0;

      res.send({
        user,menu,order,revenue
      })
    })

    //aggregate pipe-line
    app.get('/order-stats',async(req,res)=>{
      const result= await payments.aggregate([
        {
          $unwind: '$menuItemIds'//menuItemIds payments er field jeta kina array by unwind etake single single kora hoise
        },
        {
          $lookup:{
            from:'menu', //which is the exactly the same as collection name in data base and its foreign collection
            localField:'menuItemIds',
            foreignField:'_id',
            as:'menuItems'
          }
        },
        {
          $unwind: '$menuItems'
        },
        {
          $group:{
            _id:'$menuItems.category',
            quantity:{
              $sum:1
            },
            revenue:{
              $sum:"$menuItems.price"
            }
          }
        },
        {//another pipeline for change name by project
          $project:{
            _id:0,
            category:'$_id',
            quantity:'$quantity',
            revenue:'$revenue'
          },
        }
      ]).toArray()

      res.send(result)
    })

    //for post

    app.post('/carts', async (req, res) => {
      const item = req.body;
      const result = await carts.insertOne(item)
      res.send(result)
    })

    //for payment

    app.post("/create-payment-intent", async (req, res) => {
      const price  = req.body;
    // console.log()
      const amount =parseInt(price.totalPrice*100) 
      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount ,
        currency: "usd",
        // method type  kheyal kore dite hobe eta intent er option e geley dekha jabey ki ki deoa jay 
        payment_method_types: [
          "card"
        ],
      });
    
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments",async (req,res)=>{
      const payment =req.body;
      
      const paymentResult=await payments.insertOne(payment);
   
      //for delete each item from cart
      const query ={
        _id:{
          $in: payment.cartIds.map(cartid=>new ObjectId (cartid))
        }
      }

      const deleteResult=await carts.deleteMany(query);

      // send email to user

      res.send({paymentResult,deleteResult})

    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      // console.log(user)
      const query = { email: user.email }
      const existingUser = await users.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user already exists' })
      }
      else {
        const result = await users.insertOne(user)
        res.send(result)
      }
    })

    
    app.post ('/menus',verify,async (req,res)=>{
      const item =req.body;
      // console.log(item)
      const result = await menus.insertOne(item)
      res.send(result)
    })

    

    // for update / patch

    app.patch(`/users/admin/:id`, verify , AdminVerify , async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await users.updateOne(filter, updateDoc);
      res.send(result)
    })

    app.patch('/menus/:id', async (req, res) => {
      const id =req.params.id;
      const Updateitem=req.body;
      
      // console.log(id,Updateitem);
      const filter={_id: new ObjectId(id)}
      const updatedDoc={
        $set:{
              name:Updateitem.name,
              category:Updateitem.category,
              recipe:Updateitem.recipe,
              image:Updateitem.image,
              price:Updateitem.price,
        }
      }

      const updated = await menus.updateOne(filter,updatedDoc)
      res.send(updated)
    })

    //for delete

    app.delete(`/carts/:id`, verify, AdminVerify ,async (req, res) => {
      const id = req.params.id;
      // console.log(id)
      const query = { _id: new ObjectId(id) }
      const result = await carts.deleteOne(query);
      res.send(result);
    })

    app.delete('/users/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await users.deleteOne(query);
      res.send(result)
    })

    app.delete('/menu/delete/:id', async (req,res)=>{
      const id =req.params.id;
      console.log(id)
      const query = { _id: new ObjectId(id) };
      const result = await menus.deleteOne(query);
      res.send(result)
    })

    // JWT
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign({
        data: user
      }, process.env.ACCESS_TOKEN, { expiresIn: '1h' });
      res.send({ token })
    })

    // await client.connect();
    // // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}

run().catch(console.dir);


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})