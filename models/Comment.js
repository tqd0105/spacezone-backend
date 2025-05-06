const mongoose = require("mongoose");

const CommentSchema = new mongoose.Schema(
  {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post" },
    name: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: String,
    image: { type: String, default: "" }, // Lưu link ảnh nếu bình luận có ảnh
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", default: null },
    likes: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// 🔧 Virtual để lấy danh sách phản hồi của comment
CommentSchema.virtual("replies", {
  ref: "Comment",
  localField: "_id",
  foreignField: "parentId",
});

module.exports = mongoose.model("Comment", CommentSchema);
