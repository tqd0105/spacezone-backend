
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    username: { type: String, unique: true, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    avatar: { type: String, default: "/uploads/avatar/default.png" },
    coverImage: { type: String, default: "/uploads/cover/default_cover.png" },
    loginHistory: [
      {
        ip: String,
        userAgent: String,
        time: Date
      }
    ]
  },
  { timestamps: true }
);


module.exports = mongoose.model("User", UserSchema);
